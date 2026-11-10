"""讓同一位陪審員對一篇或多篇文章各評 N 次，比較平均分。

用途：提示注入測試（正常版 vs 注入版）、觀察單次評閱的波動。
用法（在 research/ 資料夾內）：
    python run_repeat.py --juror J13 --genre 散文 --n 5 \
        --file samples/essay_sample.txt --file samples/essay_injection.txt

真實執行會呼叫「檔案數 × N」次模型（不含重試）。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from statistics import mean, pstdev

from court.cli import CliError, cost_text, read_article, say, setup
from court.juror import run_juror
from court.personas import get_persona, load_personas


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="同一位陪審員重複評閱，比較平均分")
    parser.add_argument("--juror", required=True)
    parser.add_argument("--genre", required=True)
    parser.add_argument("--file", required=True, type=Path, action="append",
                        help="文章檔，可重複指定多個")
    parser.add_argument("--n", type=int, default=5, help="每篇評幾次")
    parser.add_argument("--provider", choices=["anthropic", "mock"], default=None)
    parser.add_argument("--out", type=Path, default=None, help="把全部結果存成 JSON（選填）")
    args = parser.parse_args(argv)

    try:
        settings, provider, provider_name = setup(args.provider)
        persona = get_persona(args.juror, load_personas())
        articles = {path: read_article(path, args.genre, settings) for path in args.file}
    except CliError as exc:
        say(str(exc))
        return 1
    except KeyError as exc:
        say(str(exc.args[0]))
        return 1

    say(f"陪審員 {persona.code} {persona.name}｜每篇 {args.n} 次｜共 {len(articles) * args.n} 次呼叫"
        f"｜供應商 {provider_name}｜模型 {settings.models['juror']}")

    async def run_all():
        semaphore = asyncio.Semaphore(settings.jury.concurrency)

        async def one(content: str):
            async with semaphore:
                return await run_juror(persona, genre=args.genre, title=None, content=content,
                                       settings=settings, provider=provider)

        return {
            path: await asyncio.gather(*(one(content) for _ in range(args.n)))
            for path, content in articles.items()
        }

    results = asyncio.run(run_all())
    usage = {"input_tokens": 0, "output_tokens": 0}
    model = settings.models["juror"]
    report = {}
    for path, runs in results.items():
        ok = [r for r in runs if r.status == "ok"]
        scores = [r.output.score for r in ok]
        supports = sum(1 for r in ok if r.output.would_support_award)
        for r in runs:
            usage["input_tokens"] += r.input_tokens
            usage["output_tokens"] += r.output_tokens
            model = r.model
        if scores:
            say(f"\n{path.name}：分數 {scores}｜平均 {mean(scores):.2f}｜標準差 {pstdev(scores):.2f}"
                f"｜支持得獎 {supports} / {len(ok)}｜失敗 {len(runs) - len(ok)} 次")
        else:
            say(f"\n{path.name}：{len(runs)} 次全部失敗")
        report[str(path)] = [r.model_dump() for r in runs]

    say(f"\n費用{cost_text(settings, provider_name, {model: usage})}")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        say(f"全部結果已存到 {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
