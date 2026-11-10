"""W0：對既有的陪審結果，用指定的模型重跑法官（陪審員結果重用，只多 1 次呼叫）。

用法（在 research/ 資料夾內）：
    python rerun_judge.py --session results/essay1.json --model claude-sonnet-5-5

新的判決另存成 results/essay1.judge-claude-sonnet-5-5.json，不覆蓋原本的結果。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from court.cli import CliError, cost_text, say, setup
from court.judge import JudgeResult, run_judge
from court.personas import load_personas
from court.session import load_session


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="用指定模型重跑法官")
    parser.add_argument("--session", required=True, type=Path, help="run_session.py 產生的結果檔")
    parser.add_argument("--model", required=True, help="法官要用的模型，例如 claude-sonnet-5-5")
    parser.add_argument("--provider", choices=["anthropic", "mock"], default=None)
    args = parser.parse_args(argv)

    try:
        settings, provider, provider_name = setup(args.provider)
    except CliError as exc:
        say(str(exc))
        return 1
    try:
        session = load_session(args.session)
    except FileNotFoundError:
        say(f"找不到結果檔 {args.session}，請先執行 run_session.py。")
        return 1
    if session.stats is None:
        say("這筆結果的陪審員人數不足、沒有統計，無法重跑法官。")
        return 1

    say(f"投稿 {session.submission_id}｜重跑法官｜模型 {args.model}｜供應商 {provider_name}")
    verdict: JudgeResult = asyncio.run(
        run_judge(
            genre=session.genre, title=session.title, content=session.content,
            juror_results=session.juror_results, stats=session.stats,
            personas={p.code: p for p in load_personas()},
            settings=settings, provider=provider, model=args.model,
        )
    )
    out_path = args.session.with_name(f"{args.session.stem}.judge-{args.model}.json")
    if out_path.exists():
        say(f"{out_path} 已經存在。為了不覆蓋先前的判決，請先改名或移走舊檔再重跑。")
        return 1
    out_path.write_text(verdict.model_dump_json(indent=2) + "\n", encoding="utf-8")

    if verdict.output:
        v = verdict.output
        say(f"\n【判決】{v.headline}\n\n{v.verdict}\n\n【少數意見】{'、'.join(v.minority_jurors) or '（無）'}"
            f"\n{v.minority_opinion}\n\n【最大分歧】{v.biggest_disagreement}")
    for number, reason in enumerate(verdict.attempt_errors, start=1):
        say(f"第 {number} 次失敗的原因：{reason}")
    usage = {verdict.model: {"input_tokens": verdict.input_tokens,
                             "output_tokens": verdict.output_tokens}}
    say(f"\n共呼叫 {verdict.attempts} 次｜費用{cost_text(settings, provider_name, usage)}")
    say(f"判決已存到 {out_path}")
    print(out_path)

    if verdict.status != "ok":
        say(f"法官沒有完成判決：{verdict.error}。請稍後再試一次。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
