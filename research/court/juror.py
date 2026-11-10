"""讓 1 位陪審員評 1 篇作品：組 prompt → 呼叫模型 → 驗證 JSON → 不合格就重試。"""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, ValidationError

from .config import Settings
from .llm import LLMCallError, LLMProvider, LLMRequest
from .personas import Persona
from .prompts import build_juror_system, build_juror_user
from .schemas import JurorOutput, check_juror_lengths, juror_json_schema, to_api_schema


class OutputInvalid(Exception):
    """模型輸出不符合 schema。"""


class JurorResult(BaseModel):
    """一位陪審員的結果；欄位對應 PRD 第 8 節的 juror_results 資料表。"""

    juror_code: str
    persona_version: int
    status: Literal["ok", "failed"]
    output: JurorOutput | None = None
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    attempts: int = 0
    error: str | None = None


def parse_juror_output(text: str, settings: Settings) -> JurorOutput:
    """把模型輸出的文字轉成驗證過的 JurorOutput；不合格就丟出 OutputInvalid。"""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise OutputInvalid("輸出不是合法的 JSON") from exc
    try:
        output = JurorOutput.model_validate(data)
    except ValidationError as exc:
        details = "；".join(
            f"{'.'.join(str(part) for part in err['loc']) or '(整體)'}：{err['msg']}"
            for err in exc.errors()
        )
        raise OutputInvalid(f"JSON 格式不符：{details}") from exc
    problems = check_juror_lengths(output, settings.juror_output)
    if problems:
        raise OutputInvalid("字數不符：" + "；".join(problems))
    return output


async def run_juror(
    persona: Persona,
    *,
    genre: str,
    title: str | None,
    content: str,
    settings: Settings,
    provider: LLMProvider,
) -> JurorResult:
    """單一陪審員評閱。逾時或格式不合時重試，最多 settings.juror.max_retries 次。"""
    cfg = settings.juror
    model = settings.models["juror"]
    system = build_juror_system(persona, genre)
    base_user = build_juror_user(genre, title, content, settings)
    api_schema = to_api_schema(juror_json_schema())

    result = JurorResult(
        juror_code=persona.code,
        persona_version=persona.version,
        status="failed",
        model=model,
    )
    retry_note = ""

    for attempt in range(1, cfg.max_retries + 2):
        result.attempts = attempt
        request = LLMRequest(
            model=model,
            system=system,
            user=base_user + retry_note,
            max_tokens=cfg.max_tokens,
            timeout_seconds=cfg.timeout_seconds,
            thinking=cfg.thinking,
            effort=cfg.effort,
            json_schema=api_schema,
            meta={
                "role": "juror",
                "juror_code": persona.code,
                "juror_name": persona.name,
                "focus": persona.focus,
            },
        )
        try:
            response = await provider.complete(request)
        except LLMCallError as exc:
            result.error = str(exc)
            if not exc.retryable:
                break
            continue

        result.input_tokens += response.input_tokens
        result.output_tokens += response.output_tokens
        result.latency_ms += response.latency_ms
        result.model = response.model

        try:
            if response.stop_reason == "max_tokens":
                raise OutputInvalid("輸出太長，在寫完之前就被截斷")
            result.output = parse_juror_output(response.text, settings)
        except OutputInvalid as exc:
            result.error = str(exc)
            # 重試時告訴模型上次哪裡不合格（放在 </article> 之後，屬於我們的指示）
            retry_note = f"\n\n注意：你上一次的輸出不合格（{exc}）。請修正後重新輸出完整的 JSON。"
            continue

        result.status = "ok"
        result.error = None
        break

    return result
