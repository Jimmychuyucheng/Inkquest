from collections import Counter

from court.config import load_settings, resolve_provider_name
from court.personas import get_persona, load_personas
from court.text import check_submission, count_chars, count_lines

import pytest


def test_settings_load_and_have_four_genres():
    settings = load_settings()
    assert set(settings.genres) == {"散文", "新詩", "小品文", "極短篇"}
    assert settings.models["juror"]
    assert settings.juror.max_retries == 2
    assert settings.juror.timeout_seconds == 45


def test_provider_resolution_order(monkeypatch):
    settings = load_settings()
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert resolve_provider_name(settings) == settings.default_provider
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    assert resolve_provider_name(settings) == "mock"
    assert resolve_provider_name(settings, "anthropic") == "anthropic"


def test_cost_estimate_uses_pricing_from_settings():
    settings = load_settings()
    model = settings.models["juror"]
    price = settings.pricing[model]
    expected = price.input_per_mtok + price.output_per_mtok
    assert settings.estimate_cost_usd(model, 1_000_000, 1_000_000) == pytest.approx(expected)
    assert settings.estimate_cost_usd("不存在的模型", 1, 1) is None


def test_personas_in_three_groups():
    personas = load_personas()
    assert [p.code for p in personas] == [f"J{i:02d}" for i in range(1, 24)]
    assert Counter(p.group for p in personas) == {"文學專業": 6, "一般讀者": 6, "跨界視角": 11}
    assert all(p.background and p.focus and p.tone for p in personas)
    assert all(p.voice_traits and p.vocabulary_rule for p in personas)


def test_get_persona_is_case_insensitive_and_reports_unknown():
    assert get_persona("j13").name == "木工老師傅"
    with pytest.raises(KeyError):
        get_persona("J99")


def test_count_chars_ignores_whitespace_and_newlines():
    assert count_chars("春 天\n\n來了\t　。") == 5
    assert count_lines("第一行\n\n  \n第二行\n") == 2


def test_check_submission_limits(settings):
    assert check_submission("散文", "字" * 300, settings) == []
    assert check_submission("散文", "字" * 5000, settings) == []
    assert "至少" in check_submission("散文", "字" * 299, settings)[0]
    assert "最多" in check_submission("散文", "字" * 5001, settings)[0]
    assert "沒有" in check_submission("小說", "字" * 500, settings)[0]


def test_poem_line_limit(settings):
    ok = "\n".join(["詩句"] * 60)
    too_many = "\n".join(["詩句"] * 61)
    assert check_submission("新詩", ok, settings) == []
    assert any("行" in p for p in check_submission("新詩", too_many, settings))


def test_sample_essays_are_within_limits(settings):
    from court.config import REPO_ROOT

    for name in ("essay_sample.txt", "essay_injection.txt"):
        text = (REPO_ROOT / "research" / "samples" / name).read_text(encoding="utf-8")
        assert check_submission("散文", text, settings) == []
