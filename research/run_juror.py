"""R1：讓 1 位陪審員評 1 篇作品，輸出驗證過的 JSON。

用法（在 research/ 資料夾內）：
    python run_juror.py --juror J13 --genre 散文 --file samples/essay_sample.txt

加上 --provider mock 就不會呼叫真實 API（不花錢）。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

from court.config import REPO_ROOT, load_settings, resolve_provider_name
from court.juror import run_juror
from court.llm import LLMCallError, get_provider
from court.personas import get_persona, load_personas
from court.text import check_submission, count_chars


def fail(message: str) -> int:
    print(message, file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="讓 1 位陪審員評 1 篇作品")
    parser.add_argument("--juror", required=True, help="陪審員編號，例如 J13")
    parser.add_argument("--genre", required=True, help="文類：散文、新詩、小品文、極短篇")
    parser.add_argument("--file", required=True, type=Path, help="文章的 .txt 檔（UTF-8）")
    parser.add_argument("--title", default=None, help="標題（選填）")
    parser.add_argument("--provider", choices=["anthropic", "mock"], default=None,
                        help="覆蓋 LLM_PROVIDER；mock 不呼叫真實 API")
    parser.add_argument("--out", type=Path, default=None, help="把結果另存成 JSON 檔（選填）")
    args = parser.parse_args(argv)

    # 只把 .env 載入環境變數，不讀取也不輸出其中的內容
    load_dotenv(REPO_ROOT / ".env")
    settings = load_settings()

    try:
        persona = get_persona(args.juror, load_personas())
    except KeyError as exc:
        return fail(str(exc.args[0]))
    if not persona.enabled:
        return fail(f"陪審員 {persona.code} 目前是停用狀態，請換一位。")

    try:
        content = args.file.read_text(encoding="utf-8")
    except FileNotFoundError:
        return fail(f"找不到檔案 {args.file}，請確認路徑。")
    except UnicodeDecodeError:
        return fail(f"{args.file} 不是 UTF-8 編碼的文字檔，請另存成 UTF-8 後再試。")

    problems = check_submission(args.genre, content, settings)
    if problems:
        return fail("\n".join(problems))

    provider_name = resolve_provider_name(settings, args.provider)
    try:
        provider = get_provider(settings, args.provider)
    except LLMCallError as exc:
        return fail(str(exc))

    print(
        f"陪審員 {persona.code} {persona.name}｜文類 {args.genre}｜{count_chars(content)} 字｜"
        f"供應商 {provider_name}｜模型 {settings.models['juror']}",
        file=sys.stderr,
    )

    result = asyncio.run(
        run_juror(
            persona,
            genre=args.genre,
            title=args.title,
            content=content,
            settings=settings,
            provider=provider,
        )
    )

    result_json = result.model_dump_json(indent=2)
    print(result_json)
    if args.out:
        args.out.write_text(result_json + "\n", encoding="utf-8")

    cost = settings.estimate_cost_usd(result.model, result.input_tokens, result.output_tokens)
    if provider_name == "mock":
        cost_text = " US$0（假資料模式不計費）"
    elif cost is not None:
        cost_text = f"約 US${cost:.5f}"
    else:
        cost_text = "無法估算（settings.yaml 沒有這個模型的單價）"
    print(
        f"嘗試 {result.attempts} 次｜輸入 {result.input_tokens} tokens｜"
        f"輸出 {result.output_tokens} tokens｜{result.latency_ms} ms｜費用{cost_text}",
        file=sys.stderr,
    )

    if result.status != "ok":
        return fail(f"這次評閱沒有成功：{result.error}。請稍後再試一次。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
