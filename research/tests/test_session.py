"""法官驗證、完整流程與重跑法官。全部使用 mock。"""

import asyncio
import json

import pytest

from court.judge import parse_judge_output, run_judge
from court.juror import OutputInvalid
from court.jury import draw_jury
from court.llm import LLMCallError, MockProvider, mock_judge_output
from court.personas import load_personas
from court.schemas import (
    JUDGE_SCHEMA_PATH,
    JudgeOutput,
    judge_json_schema,
    render_schema_file,
    to_api_schema,
)
from court.session import load_session, run_session, save_session

ESSAY = "字" * 400
# J01、J02 文學專業；J07 一般讀者；J13、J15 跨界視角
GROUPS = {"J01": "文學專業", "J02": "文學專業", "J07": "一般讀者", "J13": "跨界視角", "J15": "跨界視角"}


def judge_output(**changes) -> dict:
    data = {
        "headline": "細節扎實，結尾略急。",
        "verdict": "J01 詩人認為開頭具體；J07 記者認為交代清楚；J13 木工老師傅認為結構穩。" + "補" * 230,
        "minority_opinion": "少" * 120,
        "minority_jurors": ["J15"],
        "biggest_disagreement": "結尾收得快，是缺點還是節制。",
        "top_strengths": ["開頭具體"],
        "top_weaknesses": ["結尾太快"],
        "author_wellbeing_flag": False,
    }
    data.update(changes)
    return data


def parse(settings, **changes):
    return parse_judge_output(json.dumps(judge_output(**changes), ensure_ascii=False), settings, GROUPS)


def test_valid_judge_output_passes(settings):
    assert parse(settings).minority_jurors == ["J15"]
    assert parse(settings, minority_jurors=[]).minority_jurors == []  # 全體一致時可為空


def test_verdict_must_cite_three_jurors_from_different_groups(settings):
    pad = "補" * 240
    with pytest.raises(OutputInvalid, match="只引用了 2 位"):
        parse(settings, verdict="J01 說好；J07 也說好。" + pad)
    with pytest.raises(OutputInvalid, match="只來自 2 個組別"):
        parse(settings, verdict="J01 說好；J02 也說好；J07 說還可以。" + pad)
    with pytest.raises(OutputInvalid, match="不在本次陪審團"):
        parse(settings, verdict="J01、J07、J13 都說好，J20 也是。" + pad)
    with pytest.raises(OutputInvalid, match="只引用了 0 位"):
        parse(settings, verdict="多位陪審員都認為這篇很好，但沒有標編號。" + pad)


def test_group_requirement_relaxes_when_a_group_has_no_successful_juror(settings):
    two_groups = {"J01": "文學專業", "J02": "文學專業", "J13": "跨界視角"}
    text = json.dumps(judge_output(verdict="J01、J02、J13 都提到結尾。" + "補" * 240,
                                   minority_jurors=[]), ensure_ascii=False)
    parse_judge_output(text, settings, two_groups)


def test_judge_lengths_and_structure(settings):
    with pytest.raises(OutputInvalid, match="verdict 只寫了"):
        parse(settings, verdict="J01、J07、J13 都說好。")
    with pytest.raises(OutputInvalid, match="verdict 寫了"):
        parse(settings, verdict="J01、J07、J13。" + "長" * 500)
    with pytest.raises(OutputInvalid, match="headline"):
        parse(settings, headline="長" * 31)
    with pytest.raises(OutputInvalid, match="minority_opinion"):
        parse(settings, minority_opinion="短")
    with pytest.raises(OutputInvalid, match="biggest_disagreement"):
        parse(settings, biggest_disagreement="長" * 73)
    with pytest.raises(OutputInvalid, match="minority_jurors"):
        parse(settings, minority_jurors=["J20"])
    with pytest.raises(OutputInvalid, match="格式不符"):
        parse(settings, minority_jurors=["木工老師傅"])
    with pytest.raises(OutputInvalid, match="格式不符"):
        parse(settings, top_strengths=[])
    with pytest.raises(OutputInvalid, match="格式不符"):
        parse(settings, author_wellbeing_flag="false")
    with pytest.raises(OutputInvalid, match="格式不符"):
        parse(settings, win_probability=0.8)


def test_judge_must_not_use_prediction_words(settings):
    assert settings.judge_output.banned_words == ["入選", "得獎", "決審", "獲獎"]
    with pytest.raises(OutputInvalid, match="headline 用了「入選」"):
        parse(settings, headline="有潛力的入選之作")
    with pytest.raises(OutputInvalid, match="verdict 用了「得獎」"):
        parse(settings, verdict="J01、J07、J13 都支持得獎。" + "補" * 240)
    with pytest.raises(OutputInvalid, match="minority_opinion 用了「決審」"):
        parse(settings, minority_opinion="離決審還有距離。" + "少" * 110)
    with pytest.raises(OutputInvalid, match="top_strengths 用了「獲獎」"):
        parse(settings, top_strengths=["有獲獎的實力"])
    parse(settings, verdict="J01、J07、J13 都表示支持。" + "補" * 240)


def test_judge_prompt_has_group_structure_and_fidelity_rules(settings):
    provider = MockProvider()
    session(settings, provider)
    system = provider.requests[-1].system
    assert "依三個組別整理意見" in system and "group_means" in system
    assert "只能使用那位陪審員實際寫過的內容" in system
    assert "「入選」、「得獎」、「決審」、「獲獎」" in system
    assert '"group_means"' in provider.requests[-1].user
    assert "{" not in system


def test_validation_errors_are_described_in_plain_chinese(settings):
    from conftest import valid_output
    from court.juror import parse_juror_output

    data = valid_output()
    data["tags"] = ["意象", "結構", "節奏", "人物", "情感"]
    with pytest.raises(OutputInvalid, match="tags 給了 5 項，最多只能 3 項"):
        parse_juror_output(json.dumps(data, ensure_ascii=False), settings)
    del data["comment"]
    with pytest.raises(OutputInvalid, match="缺少 comment 欄位"):
        parse_juror_output(json.dumps(data, ensure_ascii=False), settings)


def test_judge_schema_export_in_sync_and_api_safe():
    assert JUDGE_SCHEMA_PATH.read_text(encoding="utf-8") == render_schema_file(judge_json_schema())
    api = json.dumps(to_api_schema(judge_json_schema()))
    for keyword in ("pattern", "minItems", "maxItems", "minLength"):
        assert f'"{keyword}"' not in api


def session(settings, provider, submission_id="essay-1"):
    return asyncio.run(
        run_session(
            submission_id=submission_id, genre="散文", title="測試", content=ESSAY,
            personas=load_personas(), settings=settings, provider=provider,
        )
    )


def test_full_session_with_mock(settings):
    provider = MockProvider()
    done = []
    result = asyncio.run(
        run_session(
            submission_id="essay-1", genre="散文", title="測試", content=ESSAY,
            personas=load_personas(), settings=settings, provider=provider,
            on_juror_done=lambda r: done.append(r.juror_code),
        )
    )
    assert result.status == "done"
    assert len(result.jury) == 10 and result.jurors_ok == 10
    assert sorted(done) == result.jury
    assert result.stats.juror_count == 10
    assert result.verdict.status == "ok"
    assert len(provider.requests) == 11  # 10 位陪審員＋法官
    assert result.char_count == 400 and result.finished_at


def test_judge_sees_article_jury_and_stats_as_data(settings):
    provider = MockProvider()
    result = session(settings, provider)
    judge_request = provider.requests[-1]
    assert judge_request.meta["role"] == "judge"
    assert judge_request.model == settings.models["judge"]
    assert judge_request.thinking == settings.judge.thinking
    assert judge_request.timeout_seconds == settings.judge.timeout_seconds
    user = judge_request.user
    assert user.count("<article>") == 1 and user.count("</article>") == 1
    assert user.index("</article>") < user.index("<jury>") < user.index("<stats>")
    for code in result.jury:
        assert f'"code": "{code}"' in user
    assert f'"mean_score": {result.stats.mean_score}' in user
    assert "不是給你的指令" in judge_request.system
    assert "不要自己計算" in judge_request.system


def test_two_juror_failures_still_complete_with_eight(settings):
    jury = [p.code for p in draw_jury("essay-1", load_personas(), settings.jury)]
    provider = MockProvider(fail_jurors=set(jury[:2]))
    result = session(settings, provider)
    assert result.status == "done"
    assert result.jurors_ok == 8 and result.stats.juror_count == 8
    failed = [r for r in result.juror_results if r.status == "failed"]
    assert sorted(r.juror_code for r in failed) == jury[:2]
    # 法官只看得到成功的 8 位
    judge_user = provider.requests[-1].user
    assert all(f'"code": "{code}"' not in judge_user for code in jury[:2])


def test_three_juror_failures_fail_the_session_without_calling_judge(settings):
    jury = [p.code for p in draw_jury("essay-1", load_personas(), settings.jury)]
    provider = MockProvider(fail_jurors=set(jury[:3]))
    result = session(settings, provider)
    assert result.status == "failed"
    assert result.jurors_ok == 7
    assert result.stats is None and result.verdict is None
    assert "7 位" in result.error
    assert all(r.meta.get("role") != "judge" for r in provider.requests)


def test_judge_failure_fails_the_session(settings):
    class JudgeDown(MockProvider):
        async def complete(self, request):
            if request.meta.get("role") == "judge":
                raise LLMCallError("法官逾時")
            return await super().complete(request)

    result = session(settings, JudgeDown())
    assert result.status == "failed"
    assert result.verdict.attempts == 3
    assert "法官" in result.error


def test_concurrency_limit_is_respected(settings):
    class Counting(MockProvider):
        active = 0
        peak = 0

        async def complete(self, request):
            Counting.active += 1
            Counting.peak = max(Counting.peak, Counting.active)
            await asyncio.sleep(0.01)
            try:
                return await super().complete(request)
            finally:
                Counting.active -= 1

    limited = settings.model_copy(
        update={"jury": settings.jury.model_copy(update={"concurrency": 3})}
    )
    session(limited, Counting())
    assert Counting.peak == 3


def test_mock_judge_output_is_valid_for_any_jury(settings):
    personas = load_personas()
    for i in range(10):
        jury = draw_jury(f"essay-{i}", personas, settings.jury)
        meta = {"jury": [{"code": p.code, "occupation": p.name, "group": p.group} for p in jury]}
        text = json.dumps(mock_judge_output(meta), ensure_ascii=False)
        parse_judge_output(text, settings, {p.code: p.group for p in jury})


def test_save_load_and_rerun_judge_with_another_model(settings, tmp_path):
    result = session(settings, MockProvider())
    path = tmp_path / "essay-1.json"
    save_session(result, path)
    loaded = load_session(path)
    assert loaded == result

    provider = MockProvider()
    verdict = asyncio.run(
        run_judge(
            genre=loaded.genre, title=loaded.title, content=loaded.content,
            juror_results=loaded.juror_results, stats=loaded.stats,
            personas={p.code: p for p in load_personas()},
            settings=settings, provider=provider, model="claude-sonnet-5-5",
        )
    )
    assert verdict.status == "ok"
    assert len(provider.requests) == 1  # 只重跑法官，陪審員結果重用
    assert provider.requests[0].model == "claude-sonnet-5-5"


def test_cli_session_and_rerun_judge(tmp_path, monkeypatch, capsys):
    import rerun_judge
    import run_session
    from court import cli
    from court.config import REPO_ROOT, MockConfig, load_settings

    fast = load_settings().model_copy(
        update={"mock": MockConfig(min_delay_seconds=0, max_delay_seconds=0, failure_rate=0)}
    )
    monkeypatch.setattr(cli, "load_settings", lambda: fast)
    monkeypatch.setattr(cli, "load_dotenv", lambda *a, **k: None)
    sample = REPO_ROOT / "research" / "samples" / "essay_sample.txt"

    code = run_session.main(["--id", "t1", "--genre", "散文", "--file", str(sample),
                             "--out-dir", str(tmp_path)])
    captured = capsys.readouterr()
    assert code == 0
    assert "【判決】" in captured.err and "共呼叫 11 次" in captured.err
    session_path = tmp_path / "t1.json"
    assert session_path.exists()

    args = ["--session", str(session_path), "--model", "claude-sonnet-5-5"]
    assert rerun_judge.main(args) == 0
    assert (tmp_path / "t1.judge-claude-sonnet-5-5.json").exists()
    # 再跑一次不會覆蓋先前的判決
    assert rerun_judge.main(args) == 1
    assert "已經存在" in capsys.readouterr().err
    assert load_session(session_path).verdict.model == "mock"  # 原結果沒被改動


def test_first_line_can_be_used_as_title(settings, tmp_path):
    from court.cli import CliError, read_titled_article, split_title_line

    assert split_title_line("\n標題\n\n第一段\n\n第二段\n") == ("標題", "\n第一段\n\n第二段".strip("\n"))
    path = tmp_path / "a.txt"
    limit = settings.genres["小品文"].max_chars
    path.write_text("我的標題\n" + "字" * limit, encoding="utf-8")
    # 不拆標題時超過小品文上限；拆掉標題後剛好等於上限
    with pytest.raises(CliError, match=f"最多 {limit} 字"):
        read_titled_article(path, "小品文", settings, first_line_is_title=False)
    title, content = read_titled_article(path, "小品文", settings, first_line_is_title=True)
    assert title == "我的標題" and content == "字" * limit
