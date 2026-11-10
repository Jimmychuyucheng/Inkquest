"""陪審團抽選：20 選 10，依組別分層，以投稿 id 為種子（PRD 第 4 節）。

抽法刻意不用程式語言內建的亂數，方便 Web App（TypeScript）做出完全相同的結果：
每位候選人算 sha256("{投稿 id}:{陪審員編號}")，同組內依雜湊值由小到大排序，取前 n 位。
同一個投稿 id 永遠抽到同一組人；停用的人設不列入；某組人數不足時從其他組補足。
"""

from __future__ import annotations

import hashlib

from .config import JuryConfig
from .personas import Persona


def _rank(seed: str, code: str) -> str:
    return hashlib.sha256(f"{seed}:{code}".encode("utf-8")).hexdigest()


def draw_jury(submission_id: str, personas: list[Persona], config: JuryConfig) -> list[Persona]:
    """回傳本次抽中的陪審員，依編號排序。"""
    enabled = [p for p in personas if p.enabled]
    ranked = sorted(enabled, key=lambda p: _rank(submission_id, p.code))

    chosen: list[Persona] = []
    for group, size in config.size_by_group.items():
        chosen.extend([p for p in ranked if p.group == group][:size])

    # 某組可用人數不足：從其他還沒被抽中的人裡，依同一個排序補足
    shortfall = config.size - len(chosen)
    if shortfall > 0:
        chosen_codes = {p.code for p in chosen}
        chosen.extend([p for p in ranked if p.code not in chosen_codes][:shortfall])

    return sorted(chosen, key=lambda p: p.code)
