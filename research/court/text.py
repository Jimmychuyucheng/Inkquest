"""字數計算與投稿檢查（PRD 第 3 節 B-4）。"""

from __future__ import annotations

import re

from .config import Settings

_WHITESPACE = re.compile(r"\s")


def count_chars(text: str) -> int:
    """字數不含空白與換行。"""
    return len(_WHITESPACE.sub("", text))


def count_lines(text: str) -> int:
    """行數以非空白行計（新詩用）。"""
    return sum(1 for line in text.splitlines() if line.strip())


def check_submission(genre: str, content: str, settings: Settings) -> list[str]:
    """檢查文類與字數。回傳白話的問題清單；空清單表示可以送出。"""
    rule = settings.genres.get(genre)
    if rule is None:
        return [f"沒有「{genre}」這個文類，請從 {'、'.join(settings.genres)} 中選一個。"]

    problems: list[str] = []
    chars = count_chars(content)
    if chars < rule.min_chars:
        problems.append(f"{genre}至少需要 {rule.min_chars} 字，目前是 {chars} 字，請再多寫一些。")
    if chars > rule.max_chars:
        problems.append(f"{genre}最多 {rule.max_chars} 字，目前是 {chars} 字，請刪減後再試。")
    if rule.max_lines is not None:
        lines = count_lines(content)
        if lines > rule.max_lines:
            problems.append(f"{genre}最多 {rule.max_lines} 行，目前是 {lines} 行，請刪減後再試。")
    return problems
