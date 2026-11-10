"""JSON 驗證（CLAUDE.md 規定一定要有測試）。"""

import json

import pytest
from pydantic import ValidationError

from court.juror import OutputInvalid, parse_juror_output
from court.schemas import (
    JUROR_SCHEMA_PATH,
    TAGS,
    JurorOutput,
    juror_json_schema,
    render_schema_file,
    to_api_schema,
)

from conftest import valid_output


def test_valid_output_passes(settings):
    output = parse_juror_output(json.dumps(valid_output()), settings)
    assert output.score == 7
    assert output.strengths[0].quote == "外婆家的後陽台"


@pytest.mark.parametrize(
    "field, value",
    [
        ("score", 11),
        ("score", -1),
        ("score", 7.5),
        ("score", "7"),
        ("would_support_award", "true"),
        ("one_line", ""),
        ("strengths", []),
        ("weaknesses", [{"point": "a", "quote": ""}] * 4),
        ("strengths", [{"point": "少了 quote"}]),
        ("tags", []),
        ("tags", ["意象", "結構", "節奏", "人物"]),
        ("tags", ["不在清單裡"]),
        ("tags", ["意象", "意象"]),
    ],
)
def test_invalid_structure_is_rejected(field, value):
    data = valid_output()
    data[field] = value
    with pytest.raises(ValidationError):
        JurorOutput.model_validate(data)


def test_missing_and_extra_fields_are_rejected():
    missing = valid_output()
    del missing["comment"]
    with pytest.raises(ValidationError):
        JurorOutput.model_validate(missing)

    extra = valid_output()
    extra["probability"] = 0.9
    with pytest.raises(ValidationError):
        JurorOutput.model_validate(extra)


def test_not_json_is_rejected(settings):
    with pytest.raises(OutputInvalid, match="JSON"):
        parse_juror_output("這不是 JSON", settings)
    with pytest.raises(OutputInvalid):
        parse_juror_output('["是 JSON 但不是物件"]', settings)


@pytest.mark.parametrize(
    "comment_len, ok",
    [(95, False), (96, True), (120, True), (250, True), (300, True), (301, False)],
)
def test_comment_length_allows_twenty_percent_tolerance(settings, comment_len, ok):
    # 設定為 120～250 字、容許 20%，所以 96～300 字可接受
    data = valid_output()
    data["comment"] = "字" * comment_len
    if ok:
        parse_juror_output(json.dumps(data), settings)
    else:
        with pytest.raises(OutputInvalid, match="comment"):
            parse_juror_output(json.dumps(data), settings)


def test_one_line_length_tolerance(settings):
    data = valid_output()
    data["one_line"] = "字" * 36
    parse_juror_output(json.dumps(data), settings)
    data["one_line"] = "字" * 37
    with pytest.raises(OutputInvalid, match="one_line"):
        parse_juror_output(json.dumps(data), settings)


def test_tag_list_matches_prd():
    assert len(TAGS) == 12
    assert "原創性" in TAGS and "真實感" in TAGS


def test_exported_schema_file_is_in_sync():
    # 改了 schemas.py 之後要重新執行 `python -m court.schemas`
    assert JUROR_SCHEMA_PATH.read_text(encoding="utf-8") == render_schema_file(juror_json_schema())


def test_api_schema_drops_unsupported_keywords_but_keeps_structure():
    api = to_api_schema(juror_json_schema())
    text = json.dumps(api)
    for keyword in ("minimum", "maximum", "minItems", "maxItems", "minLength"):
        assert f'"{keyword}"' not in text
    assert api["additionalProperties"] is False
    assert set(api["required"]) == set(valid_output())
    assert set(api["properties"]) == set(valid_output())
    assert sorted(api["properties"]["tags"]["items"]["enum"]) == sorted(TAGS)


def test_api_schema_keeps_fields_named_like_keywords():
    schema = {"type": "object", "properties": {"title": {"type": "string", "maxLength": 5}}}
    assert to_api_schema(schema) == {"type": "object", "properties": {"title": {"type": "string"}}}
