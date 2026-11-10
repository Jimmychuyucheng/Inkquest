"""匯出「Python 與 TypeScript 必須算出相同結果」的對照資料。

研究腳本與 Web App 各自實作了字數計算、陪審團抽選與計分。這支腳本用 Python 的實作
算出一批標準答案，存成 shared/fixtures/parity.json；Web App 的測試會讀這個檔，
確認 TypeScript 算出一模一樣的結果。

改了抽選、計分或字數計算之後，在 research/ 執行：
    python export_parity_fixtures.py
"""

from __future__ import annotations

import json
import random

from court.config import SHARED_DIR, load_settings
from court.jury import draw_jury
from court.personas import load_personas
from court.schemas import TAGS, JurorOutput
from court.stats import compute_stats
from court.text import count_chars, count_lines

FIXTURE_PATH = SHARED_DIR / "fixtures" / "parity.json"

TEXTS = [
    "春 天\n\n來了\t　。",
    "第一行\n\n  \n第二行\n",
    "　全形空白　開頭與結尾　",
    "Hello, 世界！ 123",
    "雨停了\n\n　　窗台上\n一隻麻雀\r\n最後一行",
    "",
]

SUBMISSION_IDS = [
    "essay-1",
    "abc",
    "3f2b8c1e-9d4a-4f6b-8a2e-5c7d1e9f0a3b",
    "投稿甲",
    "00000000-0000-0000-0000-000000000000",
]


def build() -> dict:
    settings = load_settings()
    personas = load_personas()
    by_code = {p.code: p for p in personas}

    juries = {
        sid: [p.code for p in draw_jury(sid, personas, settings.jury)] for sid in SUBMISSION_IDS
    }
    # 有人設停用時的抽選（含某組人數不足、從其他組補足）
    disabled = ["J01", "J02", "J03", "J04", "J05", "J13"]
    adjusted = [p.model_copy(update={"enabled": p.code not in disabled}) for p in personas]
    juries_with_disabled = {
        "disabled": disabled,
        "juries": {
            sid: [p.code for p in draw_jury(sid, adjusted, settings.jury)] for sid in SUBMISSION_IDS
        },
    }

    # 固定種子產生幾組分數，涵蓋 8～10 位、各種支持比例
    rng = random.Random(20261110)
    stats_cases = []
    for index, sid in enumerate(SUBMISSION_IDS * 2):
        jury = juries[sid]
        size = [10, 9, 8][index % 3]
        jurors = []
        for code in jury[:size]:
            score = rng.randint(2, 9)
            jurors.append(
                {
                    "code": code,
                    "score": score,
                    "would_support_award": rng.random() < 0.5,
                    "tags": rng.sample(list(TAGS), rng.randint(1, 3)),
                }
            )
        outputs = {
            j["code"]: JurorOutput.model_validate(
                {
                    "characters_in_text": [],
                    "score": j["score"],
                    "would_support_award": j["would_support_award"],
                    "one_line": "測試",
                    "comment": "測" * 150,
                    "strengths": [{"point": "優點", "quote": ""}],
                    "weaknesses": [{"point": "缺點", "quote": ""}],
                    "tags": j["tags"],
                }
            )
            for j in jurors
        }
        stats = compute_stats(outputs, by_code, settings.stats).model_dump()
        # JSON 的物件 key 一律是字串
        stats["distribution"] = {str(k): v for k, v in stats["distribution"].items()}
        stats_cases.append({"jurors": jurors, "stats": stats})

    return {
        "_note": "由 research/export_parity_fixtures.py 產生，請勿手動修改。",
        "text": [{"text": t, "chars": count_chars(t), "lines": count_lines(t)} for t in TEXTS],
        "juries": juries,
        "juries_with_disabled": juries_with_disabled,
        "stats": stats_cases,
    }


def render() -> str:
    return json.dumps(build(), ensure_ascii=False, indent=2) + "\n"


if __name__ == "__main__":
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(render(), encoding="utf-8")
    print(f"已匯出 {FIXTURE_PATH}")
