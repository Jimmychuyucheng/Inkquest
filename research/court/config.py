"""讀取 shared/settings.yaml。所有可調整的數值都從這裡來。"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

REPO_ROOT = Path(__file__).resolve().parents[2]
SHARED_DIR = REPO_ROOT / "shared"
SETTINGS_PATH = SHARED_DIR / "settings.yaml"

ProviderName = Literal["anthropic", "mock"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RoleConfig(_Strict):
    max_tokens: int = Field(gt=0)
    thinking: Literal["disabled", "adaptive"]
    effort: Literal["low", "medium", "high"] | None = None
    timeout_seconds: float = Field(gt=0)
    max_retries: int = Field(ge=0)


class JurorOutputLimits(_Strict):
    one_line_max: int = Field(gt=0)
    comment_min: int = Field(gt=0)
    comment_max: int = Field(gt=0)
    length_tolerance: float = Field(ge=0)


class JudgeOutputLimits(_Strict):
    headline_max: int = Field(gt=0)
    verdict_min: int = Field(gt=0)
    verdict_max: int = Field(gt=0)
    minority_min: int = Field(gt=0)
    minority_max: int = Field(gt=0)
    disagreement_max: int = Field(gt=0)
    min_cited_jurors: int = Field(ge=0)
    length_tolerance: float = Field(ge=0)


class JuryConfig(_Strict):
    size_by_group: dict[str, int]
    min_success: int = Field(ge=1)
    concurrency: int = Field(ge=1)

    @property
    def size(self) -> int:
        return sum(self.size_by_group.values())


class PotentialLabel(_Strict):
    min: float
    label: str


class StatsConfig(_Strict):
    controversy_high_std: float
    controversy_mid_std: float
    controversy_split_low: float
    controversy_split_high: float
    top_tags: int = Field(ge=1)
    potential_labels: list[PotentialLabel] = Field(min_length=1)


class GenreRule(_Strict):
    min_chars: int = Field(ge=0)
    max_chars: int = Field(gt=0)
    max_lines: int | None = None
    description: str


class Price(_Strict):
    input_per_mtok: float = Field(ge=0)
    output_per_mtok: float = Field(ge=0)


class MockConfig(_Strict):
    min_delay_seconds: float = Field(ge=0)
    max_delay_seconds: float = Field(ge=0)
    failure_rate: float = Field(ge=0, le=1)


class Settings(_Strict):
    default_provider: ProviderName
    models: dict[str, str]
    juror: RoleConfig
    juror_output: JurorOutputLimits
    jury: JuryConfig
    judge: RoleConfig
    judge_output: JudgeOutputLimits
    stats: StatsConfig
    genres: dict[str, GenreRule]
    pricing: dict[str, Price]
    mock: MockConfig

    def estimate_cost_usd(self, model: str, input_tokens: int, output_tokens: int) -> float | None:
        """依設定檔的單價估算費用；沒有該模型的單價時回傳 None。"""
        price = self.pricing.get(model)
        if price is None:
            return None
        return (
            input_tokens * price.input_per_mtok + output_tokens * price.output_per_mtok
        ) / 1_000_000


def load_settings(path: Path | None = None) -> Settings:
    with open(path or SETTINGS_PATH, encoding="utf-8") as f:
        return Settings.model_validate(yaml.safe_load(f))


def resolve_provider_name(settings: Settings, override: str | None = None) -> str:
    """決定要用哪個供應商：命令列參數 > 環境變數 LLM_PROVIDER > 設定檔。"""
    return override or os.environ.get("LLM_PROVIDER") or settings.default_provider
