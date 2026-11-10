"""陪審團抽選與計分（PRD 第 4、6 節）。"""

from collections import Counter

import pytest

from court.jury import draw_jury
from court.personas import load_personas
from court.schemas import JurorOutput
from court.stats import compute_stats, round_half_up

from conftest import valid_output


def groups_of(jury):
    return Counter(p.group for p in jury)


def test_draw_is_stratified_three_three_four(settings):
    jury = draw_jury("essay-1", load_personas(), settings.jury)
    assert len(jury) == 10 and len({p.code for p in jury}) == 10
    assert groups_of(jury) == {"文學專業": 3, "一般讀者": 3, "跨界視角": 4}
    assert [p.code for p in jury] == sorted(p.code for p in jury)


def test_same_id_gives_same_jury_and_different_ids_vary(settings):
    personas = load_personas()
    first = [p.code for p in draw_jury("essay-1", personas, settings.jury)]
    assert first == [p.code for p in draw_jury("essay-1", personas, settings.jury)]
    assert first == [p.code for p in draw_jury("essay-1", list(reversed(personas)), settings.jury)]
    juries = {tuple(p.code for p in draw_jury(f"essay-{i}", personas, settings.jury)) for i in range(20)}
    assert len(juries) > 10
    seen = {code for jury in juries for code in jury}
    assert len(seen) == 20  # 多投幾次，20 位都有機會出現


def test_draw_matches_documented_algorithm(settings):
    # 抽法：同組內依 sha256("{id}:{編號}") 由小到大取前 n 位。Web App 要做出相同結果。
    import hashlib

    personas = load_personas()
    expected = []
    for group, size in settings.jury.size_by_group.items():
        members = [p.code for p in personas if p.group == group]
        members.sort(key=lambda code: hashlib.sha256(f"abc:{code}".encode()).hexdigest())
        expected += members[:size]
    assert [p.code for p in draw_jury("abc", personas, settings.jury)] == sorted(expected)


def test_disabled_personas_are_excluded_and_shortfall_is_filled(settings):
    personas = load_personas()
    # 文學專業只留 1 位可用：不足的 2 位要從其他組補足
    disabled = {"J01", "J02", "J03", "J04", "J05"}
    adjusted = [p.model_copy(update={"enabled": p.code not in disabled}) for p in personas]
    jury = draw_jury("essay-1", adjusted, settings.jury)
    assert len(jury) == 10
    assert not disabled & {p.code for p in jury}
    assert groups_of(jury)["文學專業"] == 1


def outputs_from(scores_supports: dict[str, tuple[int, bool]], tags=None) -> dict[str, JurorOutput]:
    result = {}
    for code, (score, support) in scores_supports.items():
        data = valid_output()
        data.update(score=score, would_support_award=support)
        if tags and code in tags:
            data["tags"] = tags[code]
        result[code] = JurorOutput.model_validate(data)
    return result


def test_stats_hand_computed_example(settings):
    personas = {p.code: p for p in load_personas()}
    outputs = outputs_from(
        {
            "J01": (8, True), "J02": (7, True), "J03": (6, False),      # 文學專業 平均 7.0
            "J07": (7, True), "J08": (9, True), "J09": (5, False),      # 一般讀者 平均 7.0
            "J13": (7, True), "J14": (4, False), "J15": (8, True), "J16": (6, True),  # 跨界 6.25 → 6.3
        },
        tags={"J01": ["意象"], "J02": ["意象", "人物"], "J03": ["人物"], "J07": ["意象"]},
    )
    stats = compute_stats(outputs, personas, settings.stats)
    assert stats.juror_count == 10
    assert stats.mean_score == 6.7
    assert stats.support_count == 7 and stats.support_ratio == 0.70
    assert stats.potential_label == "多數陪審員支持"
    # 6.25 四捨五入為 6.3（遇 5 進位，與 JavaScript 一致；Python 內建 round 會給 6.2）
    assert stats.group_means == {"文學專業": 7.0, "一般讀者": 7.0, "跨界視角": 6.3}
    assert stats.distribution == {0: 0, 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 2, 7: 3, 8: 2, 9: 1, 10: 0}
    assert stats.score_std == pytest.approx(1.42, abs=0.01)  # 母體標準差
    assert stats.controversy == "高"  # 支持比例 0.70 落在 0.30～0.70
    # 其餘 6 位用預設的 ["結構", "結尾"]：結構 6、結尾 6、意象 3、人物 2
    assert stats.top_tags == ["結構", "結尾", "意象"]


@pytest.mark.parametrize(
    "scores, supports, expected",
    [
        ([7, 7, 7, 7, 7, 7, 7, 7, 7, 7], 10, "低"),   # 標準差 0、比例 1.0
        ([7, 7, 7, 7, 7, 7, 7, 7, 7, 7], 5, "高"),    # 比例 0.5 落在 0.30～0.70
        ([3, 3, 3, 3, 3, 9, 9, 9, 9, 9], 10, "高"),   # 標準差 3
        ([5, 5, 5, 5, 5, 8, 8, 8, 8, 8], 10, "中"),   # 標準差 1.5
        ([6, 6, 6, 6, 6, 8, 8, 8, 8, 8], 8, "中"),    # 標準差 1.0（>= 0.8）、比例 0.8
        ([7] * 10, 3, "高"),                           # 比例 0.3，剛好在分歧區間邊界
        ([7] * 10, 7, "高"),                           # 比例 0.7，剛好在分歧區間邊界
        ([7] * 10, 2, "低"),                           # 比例 0.2、標準差 0
        ([7, 7, 7, 7, 7, 7, 7, 7, 6, 6], 8, "低"),    # 標準差 0.4、比例 0.8（W0 的典型情況）
    ],
)
def test_controversy_levels(settings, scores, supports, expected):
    personas = {p.code: p for p in load_personas()}
    codes = [f"J{i:02d}" for i in range(1, 11)]
    outputs = outputs_from({c: (s, i < supports) for i, (c, s) in enumerate(zip(codes, scores))})
    assert compute_stats(outputs, personas, settings.stats).controversy == expected


@pytest.mark.parametrize(
    "supports, total, label",
    [(8, 10, "陪審團高度肯定"), (6, 8, "陪審團高度肯定"), (5, 10, "多數陪審員支持"),
     (4, 10, "意見分歧，少數支持"), (2, 8, "意見分歧，少數支持"), (2, 10, "陪審團多有保留"),
     (0, 9, "陪審團多有保留")],
)
def test_potential_labels(settings, supports, total, label):
    personas = {p.code: p for p in load_personas()}
    codes = [f"J{i:02d}" for i in range(1, total + 1)]
    outputs = outputs_from({c: (6, i < supports) for i, c in enumerate(codes)})
    stats = compute_stats(outputs, personas, settings.stats)
    assert stats.potential_label == label
    assert stats.juror_count == total


def test_round_half_up():
    assert round_half_up(25, 4, 1) == 6.3      # 6.25
    assert round_half_up(13, 2, 0) == 7.0      # 6.5
    assert round_half_up(5, 8, 2) == 0.63      # 0.625
    assert round_half_up(2, 3, 2) == 0.67
    assert round_half_up(67, 10, 1) == 6.7


def test_stats_with_missing_group_and_no_outputs(settings):
    personas = {p.code: p for p in load_personas()}
    stats = compute_stats(outputs_from({"J01": (7, True), "J13": (5, False)}), personas, settings.stats)
    assert stats.group_means == {"文學專業": 7.0, "一般讀者": None, "跨界視角": 5.0}
    with pytest.raises(ValueError):
        compute_stats({}, personas, settings.stats)
