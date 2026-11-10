"""單一陪審員流程：成功、格式不合重試、逾時重試、全部失敗。全部使用 mock。"""

import asyncio
import json

import pytest

from court.config import MockConfig
from court.juror import run_juror
from court.llm import LLMCallError, MockProvider, get_provider, mock_juror_output
from court.personas import get_persona, load_personas
from court.schemas import JurorOutput, check_juror_lengths

from conftest import valid_output

ESSAY = "字" * 400


def judge(provider, settings, code="J13"):
    return asyncio.run(
        run_juror(
            get_persona(code),
            genre="散文",
            title=None,
            content=ESSAY,
            settings=settings,
            provider=provider,
        )
    )


def test_success_on_first_attempt(settings, mock_provider):
    result = judge(mock_provider, settings)
    assert result.status == "ok"
    assert result.attempts == 1
    assert result.juror_code == "J13"
    assert result.persona_version == 1
    assert result.error is None
    assert isinstance(result.output, JurorOutput)


def test_request_carries_settings_and_schema(settings, mock_provider):
    judge(mock_provider, settings)
    request = mock_provider.requests[0]
    assert request.model == settings.models["juror"]
    assert request.max_tokens == settings.juror.max_tokens
    assert request.timeout_seconds == settings.juror.timeout_seconds
    assert request.thinking == settings.juror.thinking
    assert request.json_schema["type"] == "object"
    assert "<article>" in request.user and "木工老師傅" in request.system


def test_invalid_output_then_valid_retries_once(settings):
    bad = valid_output()
    bad["score"] = 99
    provider = MockProvider(script=[bad, valid_output()])
    result = judge(provider, settings)
    assert result.status == "ok"
    assert result.attempts == 2
    assert result.output.score == 7
    # 最後成功時 error 清空，但仍留下第一次失敗的原因
    assert result.error is None
    assert len(result.attempt_errors) == 1 and "score" in result.attempt_errors[0]
    # 第二次的 prompt 會說明上次哪裡不合格，而且寫在待評區塊之後
    retry_user = provider.requests[1].user
    assert "上一次的輸出不合格" in retry_user
    assert retry_user.index("</article>") < retry_user.index("上一次的輸出不合格")
    assert "上一次的輸出不合格" not in provider.requests[0].user


def test_gives_up_after_two_retries(settings):
    provider = MockProvider(script=["不是 JSON"] * 5)
    result = judge(provider, settings)
    assert result.status == "failed"
    assert result.attempts == 3  # 第一次 + 重試 2 次
    assert len(provider.requests) == 3
    assert result.output is None
    assert "JSON" in result.error


def test_timeout_is_retried(settings):
    provider = MockProvider(script=[LLMCallError("模型超過 45 秒沒有回應"), valid_output()])
    result = judge(provider, settings)
    assert result.status == "ok"
    assert result.attempts == 2


def test_non_retryable_error_stops_immediately(settings):
    provider = MockProvider(script=[LLMCallError("金鑰無效", retryable=False), valid_output()])
    result = judge(provider, settings)
    assert result.status == "failed"
    assert result.attempts == 1
    assert len(provider.requests) == 1


def test_truncated_output_counts_as_failure(settings):
    class Truncating(MockProvider):
        async def complete(self, request):
            response = await super().complete(request)
            response.stop_reason = "max_tokens"
            return response

    result = judge(Truncating(), settings)
    assert result.status == "failed"
    assert "截斷" in result.error


def test_retry_count_comes_from_settings(settings):
    no_retry = settings.model_copy(
        update={"juror": settings.juror.model_copy(update={"max_retries": 0})}
    )
    provider = MockProvider(script=["壞掉"] * 3)
    assert judge(provider, no_retry).attempts == 1


def test_mock_outputs_are_valid_and_differ_per_juror(settings):
    outputs = {}
    for persona in load_personas():
        data = mock_juror_output(
            {"juror_code": persona.code, "juror_name": persona.name, "focus": persona.focus}
        )
        output = JurorOutput.model_validate(data)
        assert check_juror_lengths(output, settings.juror_output) == []
        outputs[persona.code] = json.dumps(data, ensure_ascii=False)
    assert len(set(outputs.values())) == 20


def test_mock_can_simulate_failures(settings):
    always_fail = MockProvider(
        MockConfig(min_delay_seconds=0, max_delay_seconds=0, failure_rate=1.0)
    )
    result = judge(always_fail, settings)
    assert result.status == "failed"
    assert result.attempts == 3


def test_get_provider_returns_mock_under_test_env(settings):
    assert get_provider(settings).name == "mock"
    with pytest.raises(LLMCallError):
        get_provider(settings, "openai")


def test_cli_runs_end_to_end_with_mock(capsys, monkeypatch):
    import run_juror
    from court.config import REPO_ROOT, load_settings

    fast = load_settings().model_copy(
        update={"mock": MockConfig(min_delay_seconds=0, max_delay_seconds=0, failure_rate=0)}
    )
    monkeypatch.setattr(run_juror, "load_settings", lambda: fast)
    # 測試時不載入 .env，避免把真實金鑰帶進環境
    monkeypatch.setattr(run_juror, "load_dotenv", lambda *args, **kwargs: None)

    sample = REPO_ROOT / "research" / "samples" / "essay_sample.txt"
    code = run_juror.main(["--juror", "J17", "--genre", "散文", "--file", str(sample)])
    captured = capsys.readouterr()
    assert code == 0
    data = json.loads(captured.out)
    assert data["juror_code"] == "J17" and data["status"] == "ok"
    assert "辦桌總舖師" in captured.err


def test_cli_rejects_too_short_text_in_plain_language(capsys, tmp_path, monkeypatch):
    import run_juror

    monkeypatch.setattr(run_juror, "load_dotenv", lambda *args, **kwargs: None)
    short = tmp_path / "short.txt"
    short.write_text("太短了", encoding="utf-8")
    code = run_juror.main(["--juror", "J01", "--genre", "散文", "--file", str(short)])
    assert code == 1
    assert "至少需要 300 字" in capsys.readouterr().err
