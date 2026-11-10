"""單篇完整流程（PRD 第 5 節）：抽 10 位陪審員 → 並行評閱 → 計票 → 法官。"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Literal

from pydantic import BaseModel

from .config import Settings
from .judge import JudgeResult, run_judge
from .juror import JurorResult, run_juror
from .jury import draw_jury
from .llm import LLMProvider
from .personas import Persona
from .stats import SessionStats, compute_stats
from .text import count_chars


class SessionResult(BaseModel):
    """一次投稿的完整結果；欄位對應 PRD 第 8 節的 submissions 及相關資料表。"""

    submission_id: str
    genre: str
    title: str | None
    content: str
    char_count: int
    status: Literal["done", "failed"]
    jury: list[str]
    jurors_ok: int
    juror_results: list[JurorResult]
    stats: SessionStats | None = None
    verdict: JudgeResult | None = None
    error: str | None = None
    created_at: str
    finished_at: str | None = None

    def usage(self) -> dict[str, dict[str, int]]:
        """依模型加總 token 用量（陪審員＋法官）。"""
        totals: dict[str, dict[str, int]] = {}
        for item in [*self.juror_results, *([self.verdict] if self.verdict else [])]:
            bucket = totals.setdefault(item.model, {"input_tokens": 0, "output_tokens": 0, "calls": 0})
            bucket["input_tokens"] += item.input_tokens
            bucket["output_tokens"] += item.output_tokens
            bucket["calls"] += item.attempts
        return totals


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def ok_outputs(juror_results: list[JurorResult]) -> dict:
    return {r.juror_code: r.output for r in juror_results if r.status == "ok" and r.output}


async def run_session(
    *,
    submission_id: str,
    genre: str,
    title: str | None,
    content: str,
    personas: list[Persona],
    settings: Settings,
    provider: LLMProvider,
    on_juror_done: Callable[[JurorResult], None] | None = None,
) -> SessionResult:
    jury = draw_jury(submission_id, personas, settings.jury)
    by_code = {p.code: p for p in personas}
    semaphore = asyncio.Semaphore(settings.jury.concurrency)

    async def one(persona: Persona) -> JurorResult:
        async with semaphore:
            result = await run_juror(
                persona, genre=genre, title=title, content=content,
                settings=settings, provider=provider,
            )
        if on_juror_done:
            on_juror_done(result)  # 每位完成就回報，供顯示進度
        return result

    session = SessionResult(
        submission_id=submission_id,
        genre=genre,
        title=title,
        content=content,
        char_count=count_chars(content),
        status="failed",
        jury=[p.code for p in jury],
        jurors_ok=0,
        juror_results=[],
        created_at=_now(),
    )
    session.juror_results = list(await asyncio.gather(*(one(p) for p in jury)))
    outputs = ok_outputs(session.juror_results)
    session.jurors_ok = len(outputs)

    if session.jurors_ok < settings.jury.min_success:
        session.error = (
            f"只有 {session.jurors_ok} 位陪審員完成評閱，少於需要的 {settings.jury.min_success} 位"
        )
        session.finished_at = _now()
        return session

    session.stats = compute_stats(outputs, by_code, settings.stats)
    session.verdict = await run_judge(
        genre=genre, title=title, content=content,
        juror_results=session.juror_results, stats=session.stats,
        personas=by_code, settings=settings, provider=provider,
    )
    if session.verdict.status == "ok":
        session.status = "done"
    else:
        session.error = f"法官沒有完成判決：{session.verdict.error}"
    session.finished_at = _now()
    return session


def save_session(session: SessionResult, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(session.model_dump_json(indent=2) + "\n", encoding="utf-8")


def load_session(path: Path) -> SessionResult:
    return SessionResult.model_validate_json(path.read_text(encoding="utf-8"))
