"""計分與得獎潛力（PRD 第 6 節）。所有數字由程式計算，不讓模型自己報數字。"""

from __future__ import annotations

from collections import Counter
from decimal import ROUND_HALF_UP, Decimal
from statistics import pstdev
from typing import Literal

from pydantic import BaseModel

from .config import StatsConfig
from .personas import Persona
from .schemas import JurorOutput


class SessionStats(BaseModel):
    juror_count: int
    mean_score: float            # 平均分數，小數一位
    support_count: int
    support_ratio: float         # 支持比例，小數兩位
    potential_label: str         # 得獎潛力的文字說明
    group_means: dict[str, float | None]  # 各組平均；該組沒有成功的陪審員時為 None
    distribution: dict[int, int]  # 0～10 每個分數的人數
    score_std: float             # 分數標準差（母體標準差），小數兩位
    controversy: Literal["高", "中", "低"]
    top_tags: list[str]


def round_half_up(numerator: int, denominator: int, digits: int) -> float:
    """四捨五入（遇 5 進位）。

    Python 內建的 round 是「四捨六入五成雙」（6.25 會變 6.2），和 JavaScript 不同；
    這裡明確規定遇 5 進位，Web App 才能算出一樣的數字。
    """
    exponent = Decimal(1).scaleb(-digits)
    return float((Decimal(numerator) / Decimal(denominator)).quantize(exponent, ROUND_HALF_UP))


def compute_stats(
    outputs: dict[str, JurorOutput],
    personas: dict[str, Persona],
    config: StatsConfig,
) -> SessionStats:
    """outputs：成功評閱的陪審員編號 → 輸出。personas：編號 → 人設（用來查組別）。"""
    if not outputs:
        raise ValueError("沒有成功的陪審員，無法計算統計")

    scores = [o.score for o in outputs.values()]
    support_count = sum(1 for o in outputs.values() if o.would_support_award)
    ratio = support_count / len(outputs)
    std = pstdev(scores)

    groups: dict[str, list[int]] = {}
    for code, output in outputs.items():
        groups.setdefault(personas[code].group, []).append(output.score)
    group_names = dict.fromkeys(p.group for p in personas.values())
    group_means = {
        name: (round_half_up(sum(groups[name]), len(groups[name]), 1) if name in groups else None)
        for name in group_names
    }

    if std >= config.controversy_high_std or (
        config.controversy_split_low <= ratio <= config.controversy_split_high
    ):
        controversy = "高"
    elif std >= config.controversy_mid_std:
        controversy = "中"
    else:
        controversy = "低"

    labels = sorted(config.potential_labels, key=lambda item: item.min, reverse=True)
    potential = next((item.label for item in labels if ratio >= item.min), labels[-1].label)

    # 依編號順序統計，次數相同時先出現的排前面，結果才會固定
    tag_counts = Counter(tag for code in sorted(outputs) for tag in outputs[code].tags)

    return SessionStats(
        juror_count=len(outputs),
        mean_score=round_half_up(sum(scores), len(scores), 1),
        support_count=support_count,
        support_ratio=round_half_up(support_count, len(outputs), 2),
        potential_label=potential,
        group_means=group_means,
        distribution={score: scores.count(score) for score in range(11)},
        score_std=round(std, 2),
        controversy=controversy,
        top_tags=[tag for tag, _ in tag_counts.most_common(config.top_tags)],
    )
