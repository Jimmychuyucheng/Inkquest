"""命令列工具共用的小函式。"""

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

from .config import REPO_ROOT, Settings, load_settings, resolve_provider_name
from .llm import LLMCallError, LLMProvider, get_provider
from .text import check_submission


class CliError(Exception):
    """要用白話告訴使用者的錯誤。"""


def say(message: str) -> None:
    """進度與摘要印在標準錯誤，標準輸出留給結果。"""
    print(message, file=sys.stderr)


def setup(provider_override: str | None) -> tuple[Settings, LLMProvider, str]:
    # 載入 .env 只是為了 LLM_PROVIDER 這類設定；API 金鑰由 court.llm 直接從 .env 檔讀取
    load_dotenv(REPO_ROOT / ".env")
    settings = load_settings()
    provider_name = resolve_provider_name(settings, provider_override)
    try:
        provider = get_provider(settings, provider_override)
    except LLMCallError as exc:
        raise CliError(str(exc)) from exc
    key_hint = getattr(provider, "key_hint", None)
    if key_hint:
        say(f"使用金鑰 {key_hint}（來自 .env）")
    return settings, provider, provider_name


def read_article(path: Path, genre: str, settings: Settings) -> str:
    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise CliError(f"找不到檔案 {path}，請確認路徑。") from None
    except UnicodeDecodeError:
        raise CliError(f"{path} 不是 UTF-8 編碼的文字檔，請另存成 UTF-8 後再試。") from None
    problems = check_submission(genre, content, settings)
    if problems:
        raise CliError("\n".join(problems))
    return content


def cost_text(settings: Settings, provider_name: str, usage: dict[str, dict[str, int]]) -> str:
    """把各模型的用量整理成一行；usage 的格式見 SessionResult.usage()。"""
    if provider_name == "mock":
        return "US$0（假資料模式不計費）"
    parts, total, unknown = [], 0.0, False
    for model, u in usage.items():
        cost = settings.estimate_cost_usd(model, u["input_tokens"], u["output_tokens"])
        if cost is None:
            unknown = True
            continue
        total += cost
        parts.append(f"{model} 輸入 {u['input_tokens']}／輸出 {u['output_tokens']} tokens")
    text = f"約 US${total:.4f}（{'；'.join(parts)}）"
    return text + "；有模型缺少單價，未計入" if unknown else text
