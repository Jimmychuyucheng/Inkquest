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
    ) -> None:
        self._config = config or MockConfig(min_delay_seconds=0, max_delay_seconds=0, failure_rate=0)
        self._script = list(script or [])
        self._random = random.Random(seed)
        self.requests: list[LLMRequest] = []

    async def complete(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request)
        delay = self._random.uniform(self._config.min_delay_seconds, self._config.max_delay_seconds)
        if delay > 0:
            await asyncio.sleep(delay)

        if self._script:
            item = self._script.pop(0)
            if isinstance(item, Exception):
                raise item
            text = item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)
        else:
            if self._random.random() < self._config.failure_rate:
                raise LLMCallError("（假資料模式）模擬的偶發失敗")
            text = json.dumps(mock_juror_output(request.meta), ensure_ascii=False)

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
