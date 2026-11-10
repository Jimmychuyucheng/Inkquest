"""模型輸出的 JSON 格式（PRD 第 5 節）。

- 結構（型別、分數範圍、項目數、tags 清單）由 pydantic 檢查。
- 字數範圍從 settings 讀取，由 check_juror_lengths 檢查。
- 執行 `python -m court.schemas` 會把 JSON Schema 匯出到 shared/schemas/，
  供 Web App 的 zod 定義對照。
"""

from __future__ import annotations

import json
from typing import Any, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator

from .config import SHARED_DIR, JurorOutputLimits
from .text import count_chars

SCHEMA_DIR = SHARED_DIR / "schemas"
JUROR_SCHEMA_PATH = SCHEMA_DIR / "juror_output.schema.json"

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


# 結構化輸出不支援的 JSON Schema 關鍵字；這些限制改由 pydantic 在收到輸出後檢查。
_UNSUPPORTED_KEYS = {
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
    "minLength", "maxLength", "minItems", "maxItems", "title",
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


def render_schema_file(schema: dict[str, Any]) -> str:
    return json.dumps(schema, ensure_ascii=False, indent=2) + "\n"


def export_schemas() -> None:
    SCHEMA_DIR.mkdir(parents=True, exist_ok=True)
    JUROR_SCHEMA_PATH.write_text(render_schema_file(juror_json_schema()), encoding="utf-8")


if __name__ == "__main__":
    export_schemas()
    print(f"已匯出 {JUROR_SCHEMA_PATH}")
