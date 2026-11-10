"""從 shared/prompts/ 讀取模板並組出陪審員的 prompt。"""

from __future__ import annotations

import re
from pathlib import Path

from .config import SHARED_DIR, Settings
from .personas import Persona
from .schemas import TAGS

PROMPTS_DIR = SHARED_DIR / "prompts"
UNTITLED = "未命名"

_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")
_ARTICLE_TAG = re.compile(r"<\s*(/?)\s*article\s*>", re.IGNORECASE)


def load_template(name: str, prompts_dir: Path | None = None) -> str:
    return (prompts_dir or PROMPTS_DIR).joinpath(name).read_text(encoding="utf-8")


def render(template: str, values: dict[str, str]) -> str:
    """一次性替換 {名稱}。

    只掃描模板本身一次，所以填進去的內容（例如文章）即使含有 {genre} 之類的字樣，
    也不會被再次替換。模板中出現未提供的名稱會直接報錯。
    """

    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in values:
            raise KeyError(f"prompt 模板需要 {{{key}}}，但沒有提供")
        return values[key]

    return _PLACEHOLDER.sub(replace, template)


def neutralize_article_tags(text: str) -> str:
    """把文章裡的 <article>、</article> 換成全形括號，避免文章提前結束待評區塊。"""
    return _ARTICLE_TAG.sub(lambda m: f"＜{m.group(1)}article＞", text)


def build_juror_system(persona: Persona, genre: str) -> str:
    return render(
        load_template("juror_system.txt"),
        {
            "occupation": persona.name,
            "background": persona.background,
            "genre": genre,
            "focus": persona.focus,
            "tone": persona.tone,
        },
    )


def build_juror_user(genre: str, title: str | None, content: str, settings: Settings) -> str:
    limits = settings.juror_output
    title_text = neutralize_article_tags((title or "").strip()) or UNTITLED
    return render(
        load_template("juror_user.txt"),
        {
            "genre": genre,
            "genre_description": settings.genres[genre].description,
            "title": title_text,
            # 保留原文的換行（新詩的分行是作品的一部分），只去掉頭尾的空行
            "content": neutralize_article_tags(content.strip("\n")),
            "one_line_max": str(limits.one_line_max),
            "comment_min": str(limits.comment_min),
            "comment_max": str(limits.comment_max),
            "tags": "、".join(TAGS),
        },
    )
