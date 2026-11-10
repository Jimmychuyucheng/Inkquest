"""法官：綜合陪審員意見與程式算好的統計，寫出判決書（PRD 第 4、5 節）。"""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, ValidationError

from .config import Settings
from .juror import JurorResult, OutputInvalid
from .llm import LLMCallError, LLMProvider, LLMRequest
from .personas import Persona
from .prompts import UNTITLED, load_template, neutralize_article_tags, render
from .schemas import (
    JudgeOutput,
    check_judge_output,
    describe_validation_error,
    judge_json_schema,
    to_api_schema,
)
from .stats import SessionStats


class JudgeResult(BaseModel):
    """法官的結果；欄位對應 PRD 第 8 節的 verdicts 資料表。"""

    status: Literal["ok", "failed"]
    output: JudgeOutput | None = None
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    attempts: int = 0
    error: str | None = None
    attempt_errors: list[str] = []


def build_jury_payload(
    juror_results: list[JurorResult], personas: dict[str, Persona]
) -> list[dict]:
    """給法官看的陪審員資料：只含成功的陪審員，附上職業與組別。"""
    return [
        {
            "code": r.juror_code,
            "occupation": personas[r.juror_code].name,
            "group": personas[r.juror_code].group,
            **r.output.model_dump(),
        }
        for r in sorted(juror_results, key=lambda r: r.juror_code)
        if r.status == "ok" and r.output is not None
    ]


def build_judge_prompts(
    *,
    genre: str,
    title: str | None,
    content: str,
    jury_payload: list[dict],
    stats: SessionStats,
    settings: Settings,
) -> tuple[str, str]:
    limits = settings.judge_output
    system = render(
        load_template("judge_system.txt"),
        {
            "genre": genre,
            "min_cited_jurors": str(limits.min_cited_jurors),
            "banned_words": "、".join(f"「{word}」" for word in limits.banned_words),
        },
    )
    user = render(
        load_template("judge_user.txt"),
        {
            "genre": genre,
            "genre_description": settings.genres[genre].description,
            "title": neutralize_article_tags((title or "").strip()) or UNTITLED,
            "content": neutralize_article_tags(content.strip("\n")),
            "juror_count": str(len(jury_payload)),
            # 陪審員的引句來自文章，同樣可能含有標記字樣，一併處理
            "jury_json": neutralize_article_tags(
                json.dumps(jury_payload, ensure_ascii=False, indent=1)
            ),
            "stats_json": json.dumps(stats.model_dump(), ensure_ascii=False, indent=1),
            "headline_max": str(limits.headline_max),
            "verdict_min": str(limits.verdict_min),
            "verdict_max": str(limits.verdict_max),
            "minority_min": str(limits.minority_min),
            "minority_max": str(limits.minority_max),
            "disagreement_max": str(limits.disagreement_max),
            "min_cited_jurors": str(limits.min_cited_jurors),
        },
    )
    return system, user


def parse_judge_output(text: str, settings: Settings, jury_groups: dict[str, str]) -> JudgeOutput:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise OutputInvalid("輸出不是合法的 JSON") from exc
    try:
        output = JudgeOutput.model_validate(data)
    except ValidationError as exc:
        raise OutputInvalid(f"JSON 格式不符：{describe_validation_error(exc)}") from exc
    problems = check_judge_output(output, settings.judge_output, jury_groups)
    if problems:
        raise OutputInvalid("；".join(problems))
    return output


async def run_judge(
    *,
    genre: str,
    title: str | None,
    content: str,
    juror_results: list[JurorResult],
    stats: SessionStats,
    personas: dict[str, Persona],
    settings: Settings,
    provider: LLMProvider,
    model: str | None = None,
) -> JudgeResult:
    """呼叫法官。model 可指定其他模型（重跑法官比較用），預設用 settings.models['judge']。"""
    cfg = settings.judge
    model = model or settings.models["judge"]
    jury_payload = build_jury_payload(juror_results, personas)
    jury_groups = {item["code"]: item["group"] for item in jury_payload}
    system, base_user = build_judge_prompts(
        genre=genre, title=title, content=content,
        jury_payload=jury_payload, stats=stats, settings=settings,
    )
    api_schema = to_api_schema(judge_json_schema())

    result = JudgeResult(status="failed", model=model)
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
                "role": "judge",
                "jury": [
                    {"code": i["code"], "occupation": i["occupation"], "group": i["group"]}
                    for i in jury_payload
                ],
            },
        )
        try:
            response = await provider.complete(request)
        except LLMCallError as exc:
            result.error = str(exc)
            result.attempt_errors.append(str(exc))
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
            result.output = parse_judge_output(response.text, settings, jury_groups)
        except OutputInvalid as exc:
            result.error = str(exc)
            result.attempt_errors.append(str(exc))
            retry_note = (
                f"\n\n注意：你上一次的輸出被退回，原因是：{exc}。"
                "請針對這個原因修正，其他內容可以保留，然後重新輸出完整的 JSON。"
            )
            continue

        result.status = "ok"
        result.error = None
        break
    return result
