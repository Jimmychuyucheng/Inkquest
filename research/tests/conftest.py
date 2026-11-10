"""所有自動化測試一律使用 mock，不得呼叫真實 API。"""

from __future__ import annotations

import pytest

from court.config import MockConfig, Settings, load_settings
from court.llm import MockProvider


@pytest.fixture(autouse=True)
def _force_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    # 拿掉金鑰：就算有程式誤用真實供應商，也無法發出請求
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)


@pytest.fixture
def settings() -> Settings:
    loaded = load_settings()
    # 測試時不要延遲、不要隨機失敗
    return loaded.model_copy(
        update={"mock": MockConfig(min_delay_seconds=0, max_delay_seconds=0, failure_rate=0)}
    )


@pytest.fixture
def mock_provider() -> MockProvider:
    return MockProvider()


def valid_output() -> dict:
    return {
        "characters_in_text": ["我", "外婆"],
        "score": 7,
        "would_support_award": True,
        "one_line": "結構紮實，結尾略急。",
        "comment": "這" * 150,
        "strengths": [{"point": "開頭具體", "quote": "外婆家的後陽台"}],
        "weaknesses": [{"point": "結尾收得快", "quote": ""}],
        "tags": ["結構", "結尾"],
    }
