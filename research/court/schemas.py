"""模型輸出的 JSON 格式（PRD 第 5 節）。

- 結構（型別、分數範圍、項目數、tags 清單）由 pydantic 檢查。
- 字數範圍從 settings 讀取，由 check_juror_lengths 檢查。
- 執行 `python -m court.schemas` 會把 JSON Schema 匯出到 shared/schemas/，
  供 Web App 的 zod 定義對照。
"""

from __future__ import annotations

import json
import re
from typing import Annotated, Any, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator

from .config import SHARED_DIR, JudgeOutputLimits, JurorOutputLimits
from .text import count_chars

SCHEMA_DIR = SHARED_DIR / "schemas"
JUROR_SCHEMA_PATH = SCHEMA_DIR / "juror_output.schema.json"
JUDGE_SCHEMA_PATH = SCHEMA_DIR / "judge_output.schema.json"

Tag = Literal[
    "意象", "結構", "節奏", "人物", "情感", "題材",
    "語言", "開頭", "結尾", "真實感", "可讀性", "原創性",
]
TAGS: tuple[str, ...] = get_args(Tag)


class Point(BaseModel):
    model_config = ConfigDict(extra="forbid")

    point: str = Field(min_length=1, description="優點或缺點的說明")
    quote: str = Field(description="原文引句，可為空字串")


class JurorOutput(BaseModel):
    """單篇模式的陪審員輸出。"""

    model_config = ConfigDict(extra="forbid")

    score: StrictInt = Field(ge=0, le=10, description="0～10 的整數")
    would_support_award: StrictBool = Field(description="進入決審時是否支持得獎")
    one_line: str = Field(min_length=1, description="一句話總評")
    comment: str = Field(min_length=1, description="完整評語，用該職業的口吻")
    strengths: list[Point] = Field(min_length=1, max_length=3)
    weaknesses: list[Point] = Field(min_length=1, max_length=3)
    tags: list[Tag] = Field(min_length=1, max_length=3)

    @field_validator("tags")
    @classmethod
    def _tags_unique(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("tags 不可重複")
        return value


def check_juror_lengths(output: JurorOutput, limits: JurorOutputLimits) -> list[str]:
    """檢查字數；超出規定 20%（length_tolerance）以內可接受。回傳問題清單。"""
    tol = limits.length_tolerance
    problems: list[str] = []

    one_line = count_chars(output.one_line)
    one_line_max = limits.one_line_max * (1 + tol)
    if one_line > one_line_max:
        problems.append(f"one_line 有 {one_line} 字，超過上限 {limits.one_line_max} 字")

    comment = count_chars(output.comment)
    if comment < limits.comment_min * (1 - tol):
        problems.append(f"comment 只有 {comment} 字，少於下限 {limits.comment_min} 字")
    if comment > limits.comment_max * (1 + tol):
        problems.append(f"comment 有 {comment} 字，超過上限 {limits.comment_max} 字")
    return problems


JUROR_CODE_PATTERN = r"^J\d{2}$"
_CITED_CODE = re.compile(r"J\d{2}")


class JudgeOutput(BaseModel):
    """法官輸出（PRD 第 5 節）。"""

    model_config = ConfigDict(extra="forbid")

    headline: str = Field(min_length=1, description="一句話判決")
    verdict: str = Field(min_length=1, description="判決書，須引用陪審員並標明編號")
    minority_opinion: str = Field(min_length=1, description="少數意見書")
    minority_jurors: list[Annotated[str, Field(pattern=JUROR_CODE_PATTERN)]] = Field(
        description="持少數意見的陪審員編號；全體一致時為空陣列"
    )
    biggest_disagreement: str = Field(min_length=1, description="陪審團最大的分歧點")
    top_strengths: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1, max_length=3)
    top_weaknesses: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1, max_length=3)
    author_wellbeing_flag: StrictBool


def cited_jurors(text: str) -> list[str]:
    """文字中提到的陪審員編號（不重複，依出現順序）。"""
    return list(dict.fromkeys(_CITED_CODE.findall(text)))


def check_judge_output(
    output: JudgeOutput, limits: JudgeOutputLimits, jury_groups: dict[str, str]
) -> list[str]:
    """檢查法官輸出的字數與引用。jury_groups：本次成功評閱的陪審員編號 → 組別。"""
    tol = limits.length_tolerance
    problems: list[str] = []

    def too_long(name: str, text: str, maximum: int) -> None:
        length = count_chars(text)
        if length > maximum * (1 + tol):
            problems.append(f"{name} 有 {length} 字，超過上限 {maximum} 字")

    def too_short(name: str, text: str, minimum: int) -> None:
        length = count_chars(text)
        if length < minimum * (1 - tol):
            problems.append(f"{name} 只有 {length} 字，少於下限 {minimum} 字")

    too_long("headline", output.headline, limits.headline_max)
    too_short("verdict", output.verdict, limits.verdict_min)
    too_long("verdict", output.verdict, limits.verdict_max)
    too_short("minority_opinion", output.minority_opinion, limits.minority_min)
    too_long("minority_opinion", output.minority_opinion, limits.minority_max)
    too_long("biggest_disagreement", output.biggest_disagreement, limits.disagreement_max)

    cited = cited_jurors(output.verdict)
    unknown = [code for code in cited if code not in jury_groups]
    if unknown:
        problems.append(f"verdict 引用了不在本次陪審團的編號：{'、'.join(unknown)}")
    valid = [code for code in cited if code in jury_groups]
    if len(valid) < limits.min_cited_jurors:
        problems.append(
            f"verdict 只引用了 {len(valid)} 位陪審員，至少要 {limits.min_cited_jurors} 位並標明編號"
        )
    # 「不同組別」：需要涵蓋的組別數，取「要求引用的人數」與「本次有人成功的組別數」較小者
    groups_needed = min(limits.min_cited_jurors, len(set(jury_groups.values())))
    groups_cited = {jury_groups[code] for code in valid}
    if len(groups_cited) < groups_needed:
        problems.append(
            f"verdict 引用的陪審員只來自 {len(groups_cited)} 個組別，需要涵蓋 {groups_needed} 個組別"
        )

    unknown_minority = [code for code in output.minority_jurors if code not in jury_groups]
    if unknown_minority:
        problems.append(f"minority_jurors 有不在本次陪審團的編號：{'、'.join(unknown_minority)}")
    return problems


# 結構化輸出不支援的 JSON Schema 關鍵字；這些限制改由 pydantic 在收到輸出後檢查。
_UNSUPPORTED_KEYS = {
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
    "minLength", "maxLength", "minItems", "maxItems", "title", "pattern",
}


def to_api_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """把 pydantic 產生的 JSON Schema 轉成可以傳給模型結構化輸出的版本。"""

    def strip(node: Any, in_properties: bool = False) -> Any:
        if isinstance(node, dict):
            return {
                key: strip(value, in_properties=(key in ("properties", "$defs")))
                for key, value in node.items()
                # properties / $defs 底下的 key 是欄位名稱，不是關鍵字，不能刪
                if in_properties or key not in _UNSUPPORTED_KEYS
            }
        if isinstance(node, list):
            return [strip(item) for item in node]
        return node

    return strip(schema)


def juror_json_schema() -> dict[str, Any]:
    return JurorOutput.model_json_schema()


def judge_json_schema() -> dict[str, Any]:
    return JudgeOutput.model_json_schema()


def render_schema_file(schema: dict[str, Any]) -> str:
    return json.dumps(schema, ensure_ascii=False, indent=2) + "\n"


def export_schemas() -> None:
    SCHEMA_DIR.mkdir(parents=True, exist_ok=True)
    JUROR_SCHEMA_PATH.write_text(render_schema_file(juror_json_schema()), encoding="utf-8")
    JUDGE_SCHEMA_PATH.write_text(render_schema_file(judge_json_schema()), encoding="utf-8")


if __name__ == "__main__":
    export_schemas()
    print(f"已匯出 {JUROR_SCHEMA_PATH}\n已匯出 {JUDGE_SCHEMA_PATH}")
