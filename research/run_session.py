"""W0：單篇完整流程。抽 10 位陪審員 → 並行評閱 → 計票 → 法官。

用法（在 research/ 資料夾內）：
    python run_session.py --id essay1 --genre 散文 --file essays/essay1.txt

真實執行一次會呼叫 11 次模型（10 位陪審員＋法官，不含重試）。
結果存到 results/{id}.json（內含文章全文，已列入 .gitignore）。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from court.cli import CliError, cost_text, read_article, say, setup
from court.juror import JurorResult
from court.personas import load_personas
from court.session import SessionResult, run_session, save_session

RESULTS_DIR = Path(__file__).resolve().parent / "results"


def print_summary(session: SessionResult, names: dict[str, str]) -> None:
    say("")
    for r in session.juror_results:
        if r.status == "ok":
            mark = "支持" if r.output.would_support_award else "不支持"
            say(f"  {r.juror_code} {names[r.juror_code]}：{r.output.score} 分｜{mark}｜{r.output.one_line}")
        else:
            say(f"  {r.juror_code} {names[r.juror_code]}：本次缺席（{r.error}）")
    if session.stats:
        s = session.stats
        say(
            f"\n平均 {s.mean_score} / 10｜{s.support_count} / {s.juror_count} 位支持得獎"
            f"（{s.support_ratio:.2f}，{s.potential_label}）｜爭議程度 {s.controversy}"
            f"｜標準差 {s.score_std}"
        )
        say("各組平均：" + "、".join(f"{g} {m}" for g, m in s.group_means.items()))
        say("最常提到：" + "、".join(s.top_tags))
    if session.verdict and session.verdict.output:
        v = session.verdict.output
        say(f"\n【判決】{v.headline}\n\n{v.verdict}\n\n【少數意見】{'、'.join(v.minority_jurors) or '（無）'}"
            f"\n{v.minority_opinion}\n\n【最大分歧】{v.biggest_disagreement}")
        for number, reason in enumerate(session.verdict.attempt_errors, start=1):
            say(f"法官第 {number} 次失敗的原因：{reason}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="單篇完整流程：10 位陪審員＋法官")
    parser.add_argument("--id", required=True, help="投稿 id；同一個 id 會抽到同一組陪審員")
    parser.add_argument("--genre", required=True, help="文類：散文、新詩、小品文、極短篇")
    parser.add_argument("--file", required=True, type=Path, help="文章的 .txt 檔（UTF-8）")
    parser.add_argument("--title", default=None, help="標題（選填）")
    parser.add_argument("--provider", choices=["anthropic", "mock"], default=None)
    parser.add_argument("--out-dir", type=Path, default=RESULTS_DIR, help="結果存放的資料夾")
    args = parser.parse_args(argv)

    try:
        settings, provider, provider_name = setup(args.provider)
        content = read_article(args.file, args.genre, settings)
    except CliError as exc:
        say(str(exc))
        return 1

    personas = load_personas()
    names = {p.code: p.name for p in personas}
    say(f"投稿 {args.id}｜文類 {args.genre}｜供應商 {provider_name}｜"
        f"陪審員模型 {settings.models['juror']}｜法官模型 {settings.models['judge']}")

    def progress(result: JurorResult) -> None:
        say(f"  完成 {result.juror_code} {names[result.juror_code]}"
            f"（{'成功' if result.status == 'ok' else '失敗'}，嘗試 {result.attempts} 次）")

    session = asyncio.run(
        run_session(
            submission_id=args.id, genre=args.genre, title=args.title, content=content,
            personas=personas, settings=settings, provider=provider, on_juror_done=progress,
        )
    )
    out_path = args.out_dir / f"{args.id}.json"
    save_session(session, out_path)
    print_summary(session, names)

    calls = sum(u["calls"] for u in session.usage().values())
    say(f"\n共呼叫 {calls} 次｜費用{cost_text(settings, provider_name, session.usage())}")
    say(f"結果已存到 {out_path}")
    print(out_path)

    if session.status != "done":
        say(f"這次沒有完成：{session.error}。請稍後再試一次。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
