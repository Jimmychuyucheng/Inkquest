"""模型呼叫層：把供應商包起來，統一回傳文字、token 用量與延遲。

- anthropic：官方 SDK，真實呼叫（會花錢）。
- mock：不呼叫任何模型，回傳符合 schema 的假資料；自動化測試一律用這個。

API key 一律從專案根目錄的 .env 讀取並明確傳給 client，不使用 shell 環境裡的任何憑證。
這個模組只對外提供金鑰的末四碼（供對照 Console），不記錄、不輸出完整金鑰。
"""

from __future__ import annotations

import asyncio
import json
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from dotenv import dotenv_values

from .config import REPO_ROOT, MockConfig, Settings, resolve_provider_name

ENV_PATH = REPO_ROOT / ".env"
API_KEY_NAME = "ANTHROPIC_API_KEY"


class LLMCallError(Exception):
    """模型呼叫失敗。retryable 表示再試一次可能會成功。"""

    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


@dataclass
class LLMRequest:
    model: str
    system: str
    user: str
    max_tokens: int
    timeout_seconds: float
    thinking: str = "disabled"
    effort: str | None = None
    json_schema: dict[str, Any] | None = None
    # 給 mock 與紀錄用的附註（例如角色、陪審員編號），不會送給模型
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class LLMResponse:
    text: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: int
    stop_reason: str | None = None


class LLMProvider(Protocol):
    name: str

    async def complete(self, request: LLMRequest) -> LLMResponse: ...


def read_api_key_from_env_file(env_path: Path | None = None) -> str:
    """只從 .env 檔讀取 ANTHROPIC_API_KEY。

    刻意不看 os.environ：shell 裡就算有同名變數或其他 Anthropic 憑證，也不會被使用，
    確保費用記在 .env 那把金鑰所屬的 workspace。
    """
    path = env_path or ENV_PATH
    key = (dotenv_values(path).get(API_KEY_NAME) or "").strip() if path.is_file() else ""
    if not key:
        raise LLMCallError(
            f"在 {path} 找不到 {API_KEY_NAME}。請照 .env.example 建立 .env 並填入金鑰，"
            "或改用 LLM_PROVIDER=mock。",
            retryable=False,
        )
    return key


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, env_path: Path | None = None) -> None:
        import anthropic

        self._anthropic = anthropic
        api_key = read_api_key_from_env_file(env_path)
        # 只保留末四碼供顯示；完整金鑰只交給 SDK
        self.key_hint = f"...{api_key[-4:]}"
        # 明確傳入 api_key 時，SDK 不會再讀環境變數或本機設定檔裡的憑證。
        # 重試由我們自己的流程控制（PRD：最多重試 2 次），所以關掉 SDK 內建的重試。
        self._client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=0)

    async def complete(self, request: LLMRequest) -> LLMResponse:
        anthropic = self._anthropic
        kwargs: dict[str, Any] = {
            "model": request.model,
            "max_tokens": request.max_tokens,
            "system": request.system,
            "messages": [{"role": "user", "content": request.user}],
            "thinking": {"type": request.thinking},
        }
        # 注意：Haiku 5.5 / Sonnet 5.5 不接受自訂 temperature，所以這裡不傳取樣參數
        output_config: dict[str, Any] = {}
        if request.json_schema is not None:
            output_config["format"] = {"type": "json_schema", "schema": request.json_schema}
        if request.effort:
            output_config["effort"] = request.effort
        if output_config:
            kwargs["output_config"] = output_config

        start = time.monotonic()
        try:
            message = await self._client.messages.create(**kwargs, timeout=request.timeout_seconds)
        except anthropic.APITimeoutError as exc:
            raise LLMCallError(f"模型超過 {request.timeout_seconds:g} 秒沒有回應") from exc
        except anthropic.RateLimitError as exc:
            raise LLMCallError("呼叫太頻繁，被暫時限流") from exc
        except anthropic.APIStatusError as exc:
            raise LLMCallError(
                f"模型服務回應錯誤（HTTP {exc.status_code}）：{exc.message}",
                retryable=exc.status_code >= 500 or exc.status_code in (408, 409),
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise LLMCallError("無法連線到模型服務") from exc
        latency_ms = int((time.monotonic() - start) * 1000)

        if message.stop_reason == "refusal":
            raise LLMCallError("模型拒絕處理這段內容", retryable=False)

        # 回應開頭可能是 thinking 區塊，所以依 type 找文字，不依位置
        text = "".join(block.text for block in message.content if block.type == "text")
        return LLMResponse(
            text=text,
            model=message.model,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
            latency_ms=latency_ms,
            stop_reason=message.stop_reason,
        )


def mock_juror_output(meta: dict[str, Any]) -> dict[str, Any]:
    """依陪審員編號產生固定、但每位不同的假評閱（符合 PRD 第 5 節 schema）。"""
    code = str(meta.get("juror_code", "J00"))
    name = str(meta.get("juror_name", "陪審員"))
    focus = str(meta.get("focus", "整體表現"))
    number = int(code[1:]) if code[1:].isdigit() else 0
    score = 4 + number % 5  # 4～8 分，讓不同陪審員有不同分數
    tags = ["意象", "結構", "節奏", "人物", "情感", "題材",
            "語言", "開頭", "結尾", "真實感", "可讀性", "原創性"]
    return {
        "score": score,
        "would_support_award": score >= 7,
        "one_line": f"（假資料）{name}：有亮點，也有可再磨之處。",
        "comment": (
            f"（假資料）我是{name}，編號 {code}。我讀這篇作品時最在意的是{focus}。"
            "整體來說，文章的開頭能把人帶進場景，中段的細節也算扎實，"
            "讀得出作者確實花了心思觀察；不過結尾收得有點急，"
            "幾個本來可以多停留一下的地方被輕輕帶過，力道因此弱了一些。"
            "如果能把最想說的那件事再往前推一步，這篇會更完整，也更讓人記得住。"
        ),
        "strengths": [{"point": f"{name}認為開頭的場景描寫具體", "quote": ""}],
        "weaknesses": [{"point": f"{name}認為結尾收得太快", "quote": ""}],
        "tags": [tags[number % len(tags)], tags[(number + 5) % len(tags)]],
    }


def mock_judge_output(meta: dict[str, Any]) -> dict[str, Any]:
    """依本次陪審團名單產生假判決：每個組別各引用一位，符合 PRD 第 5 節 schema。"""
    jury = list(meta.get("jury", []))
    first_by_group: dict[str, dict[str, Any]] = {}
    for member in jury:
        first_by_group.setdefault(member["group"], member)
    cited = list(first_by_group.values())
    citations = "；".join(
        f"{m['code']} {m['occupation']}（{m['group']}）認為作品的開頭具體、結尾收得稍快" for m in cited
    )
    return {
        "headline": "（假資料）有亮點的作品，結尾可再打磨。",
        "verdict": (
            "（假資料）本庭綜合陪審團的意見後認為，這篇作品的場景描寫具體，能把讀者帶進現場，"
            "多數陪審員對開頭與中段的細節給予肯定。" + citations + "。"
            "各組的看法大致一致：優點集中在觀察的細緻與敘述的節制，缺點則集中在結尾的處理。"
            "幾位陪審員都提到，作品最想說的那件事在最後被輕輕帶過，力道因此弱了一些；"
            "也有人認為這種收法保留了餘地，不算缺點。綜合來看，這是一篇完成度不錯、"
            "但仍有修改空間的投稿，建議作者把結尾再往前推一步，讓前面累積的細節有地方落下。"
            "以上判斷完全依據陪審團提出的意見與程式計算的統計，本庭沒有另外加入新的評價。"
        ),
        "minority_opinion": (
            "（假資料）少數陪審員認為結尾收得快並不是缺點，反而讓作品保持節制，"
            "不把話說滿；如果照多數意見把結尾寫得更完整，可能會失去原本安靜的力量。"
            "這個看法值得作者在修改時一併考慮，不必急著把每個地方都交代清楚。"
        ),
        "minority_jurors": [cited[-1]["code"]] if cited else [],
        "biggest_disagreement": "（假資料）結尾收得快，是缺點還是節制。",
        "top_strengths": ["開頭的場景描寫具體"],
        "top_weaknesses": ["結尾收得太快"],
        "author_wellbeing_flag": False,
    }


class MockProvider:
    """假資料模式。可指定延遲與失敗率；也可用 script 指定每次呼叫的回應，方便測試重試。

    script 的每一項可以是：字串（直接當作模型輸出）、dict（轉成 JSON）、
    或 Exception（那一次呼叫丟出該錯誤）。script 用完後回到預設的假資料。
    """

    name = "mock"

    def __init__(
        self,
        config: MockConfig | None = None,
        *,
        script: list[Any] | None = None,
        seed: int | None = None,
        fail_jurors: set[str] | None = None,
    ) -> None:
        self._config = config or MockConfig(min_delay_seconds=0, max_delay_seconds=0, failure_rate=0)
        self._script = list(script or [])
        self._random = random.Random(seed)
        # 指定哪些陪審員一律失敗（測試「部分陪審員失敗」用）
        self._fail_jurors = set(fail_jurors or ())
        self.requests: list[LLMRequest] = []

    async def complete(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request)
        delay = self._random.uniform(self._config.min_delay_seconds, self._config.max_delay_seconds)
        if delay > 0:
            await asyncio.sleep(delay)

        if request.meta.get("juror_code") in self._fail_jurors:
            raise LLMCallError("（假資料模式）指定這位陪審員失敗", retryable=False)

        if self._script:
            item = self._script.pop(0)
            if isinstance(item, Exception):
                raise item
            text = item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)
        else:
            if self._random.random() < self._config.failure_rate:
                raise LLMCallError("（假資料模式）模擬的偶發失敗")
            make = mock_judge_output if request.meta.get("role") == "judge" else mock_juror_output
            text = json.dumps(make(request.meta), ensure_ascii=False)

        return LLMResponse(
            text=text,
            model="mock",
            input_tokens=0,
            output_tokens=0,
            latency_ms=int(delay * 1000),
            stop_reason="end_turn",
        )


def get_provider(settings: Settings, override: str | None = None) -> LLMProvider:
    name = resolve_provider_name(settings, override)
    if name == "mock":
        return MockProvider(settings.mock)
    if name == "anthropic":
        return AnthropicProvider()
    raise LLMCallError(
        f"不認得的 LLM_PROVIDER「{name}」，請改成 anthropic 或 mock。", retryable=False
    )
