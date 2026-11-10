"""金鑰來源：一定使用 .env 檔裡的 ANTHROPIC_API_KEY，不使用 shell 環境裡的憑證。

這些測試只建立 client，不發出任何請求；用的都是假金鑰。
"""

import pytest

from court.llm import AnthropicProvider, LLMCallError, read_api_key_from_env_file

FILE_KEY = "sk-ant-test-from-env-file-1111"
SHELL_KEY = "sk-ant-test-from-shell-9999"


def write_env(tmp_path, text):
    path = tmp_path / ".env"
    path.write_text(text, encoding="utf-8")
    return path


def test_env_file_key_wins_over_shell_environment(tmp_path, monkeypatch):
    env_path = write_env(tmp_path, f"ANTHROPIC_API_KEY={FILE_KEY}\n")
    monkeypatch.setenv("ANTHROPIC_API_KEY", SHELL_KEY)
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "shell-oauth-token")

    assert read_api_key_from_env_file(env_path) == FILE_KEY

    provider = AnthropicProvider(env_path)
    assert provider._client.api_key == FILE_KEY
    assert provider._client.auth_token is None
    assert provider.key_hint == "...1111"


def test_shell_key_is_not_used_when_env_file_has_none(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", SHELL_KEY)
    for env_path in (write_env(tmp_path, "LLM_PROVIDER=mock\n"), tmp_path / "不存在.env"):
        with pytest.raises(LLMCallError) as excinfo:
            AnthropicProvider(env_path)
        assert excinfo.value.retryable is False
        assert "ANTHROPIC_API_KEY" in str(excinfo.value)
        assert SHELL_KEY not in str(excinfo.value)


def test_empty_key_in_env_file_is_reported(tmp_path):
    with pytest.raises(LLMCallError):
        read_api_key_from_env_file(write_env(tmp_path, "ANTHROPIC_API_KEY=\n"))


def test_key_hint_shows_only_last_four_characters(tmp_path):
    provider = AnthropicProvider(write_env(tmp_path, f'ANTHROPIC_API_KEY="{FILE_KEY}"\n'))
    assert provider.key_hint == "...1111"
    assert FILE_KEY not in provider.key_hint
    assert len(provider.key_hint) == 7


def test_cli_prints_only_key_suffix(tmp_path, monkeypatch, capsys):
    import run_juror
    from court import llm
    from court.config import REPO_ROOT

    monkeypatch.setattr(llm, "ENV_PATH", write_env(tmp_path, f"ANTHROPIC_API_KEY={FILE_KEY}\n"))
    monkeypatch.setattr(run_juror, "load_dotenv", lambda *args, **kwargs: None)

    async def fake_run_juror(persona, **kwargs):
        # 不發出請求：只確認命令列在呼叫前印出的金鑰資訊
        from court.juror import JurorResult

        return JurorResult(juror_code=persona.code, persona_version=1, status="failed",
                           model="test", error="測試用，未呼叫")

    monkeypatch.setattr(run_juror, "run_juror", fake_run_juror)
    sample = REPO_ROOT / "research" / "samples" / "essay_sample.txt"
    run_juror.main(["--juror", "J13", "--genre", "散文", "--file", str(sample),
                    "--provider", "anthropic"])
    captured = capsys.readouterr()
    assert "使用金鑰 ...1111" in captured.err
    assert FILE_KEY not in captured.err and FILE_KEY not in captured.out
