// 核心邏輯的測試：字數、抽選、計分要與 Python 研究腳本算出相同結果。
// 對照資料由 research/export_parity_fixtures.py 產生。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { drawJury } from "./jury";
import { GROUPS, personas, settings } from "./shared";
import { computeStats, roundHalfUp, type JurorScore } from "./stats";
import { checkSubmission, countChars, countLines } from "./text";

const fixturePath = fileURLToPath(new URL("../../../../shared/fixtures/parity.json", import.meta.url));
const parity = JSON.parse(readFileSync(fixturePath, "utf8"));
const groupOf = Object.fromEntries(personas.map((p) => [p.code, p.group]));

describe("shared 設定", () => {
  it("有 20 位陪審員、三個組別 6／6／8", () => {
    expect(personas).toHaveLength(20);
    const count = (g: string) => personas.filter((p) => p.group === g).length;
    expect(GROUPS.map(count)).toEqual([6, 6, 8]);
  });

  it("額度與模型都從設定讀取", () => {
    expect(settings.web.daily_quota_per_user).toBe(3);
    expect(settings.web.global_daily_limit).toBe(25);
    expect(settings.models.juror).toBeTruthy();
  });
});

describe("字數計算（與 Python 一致）", () => {
  it.each(parity.text as { text: string; chars: number; lines: number }[])(
    "$chars 字 $lines 行",
    ({ text, chars, lines }) => {
      expect(countChars(text)).toBe(chars);
      expect(countLines(text)).toBe(lines);
    },
  );

  it("依文類檢查字數與行數", () => {
    expect(checkSubmission("散文", "字".repeat(300), settings)).toEqual([]);
    expect(checkSubmission("散文", "字".repeat(299), settings)[0]).toContain("至少需要 300 字");
    expect(checkSubmission("散文", "字".repeat(5001), settings)[0]).toContain("最多 5000 字");
    expect(checkSubmission("小說", "字".repeat(500), settings)[0]).toContain("沒有「小說」這個文類");
    const poem = (lines: number) => Array(lines).fill("詩句").join("\n");
    expect(checkSubmission("新詩", poem(60), settings)).toEqual([]);
    expect(checkSubmission("新詩", poem(61), settings).join()).toContain("最多 60 行");
  });
});

describe("陪審團抽選（與 Python 一致）", () => {
  it.each(Object.entries(parity.juries as Record<string, string[]>))("投稿 %s", (id, expected) => {
    const jury = drawJury(id, personas, settings.jury);
    expect(jury.map((p) => p.code)).toEqual(expected);
    expect(jury).toHaveLength(10);
  });

  it("停用的人設不列入，某組不足時從其他組補足", () => {
    const { disabled, juries } = parity.juries_with_disabled as {
      disabled: string[];
      juries: Record<string, string[]>;
    };
    const adjusted = personas.map((p) => ({ ...p, enabled: !disabled.includes(p.code) }));
    for (const [id, expected] of Object.entries(juries)) {
      const codes = drawJury(id, adjusted, settings.jury).map((p) => p.code);
      expect(codes).toEqual(expected);
      expect(codes.some((code) => disabled.includes(code))).toBe(false);
    }
  });

  it("同一個 id 抽到同一組人，三個組別都有人", () => {
    const first = drawJury("abc", personas, settings.jury).map((p) => p.code);
    expect(drawJury("abc", [...personas].reverse(), settings.jury).map((p) => p.code)).toEqual(first);
    expect(new Set(first.map((code) => groupOf[code])).size).toBe(3);
  });
});

describe("計分（與 Python 一致）", () => {
  it.each(
    (parity.stats as { jurors: Omit<JurorScore, "group">[]; stats: unknown }[]).map((c, i) => [i, c] as const),
  )("第 %i 組", (_, { jurors, stats }) => {
    const withGroups = jurors.map((j) => ({ ...j, group: groupOf[j.code] }));
    expect(computeStats(withGroups, GROUPS, settings.stats)).toEqual(stats);
  });

  it("四捨五入遇 5 進位", () => {
    expect(roundHalfUp(25, 4, 1)).toBe(6.3); // 6.25
    expect(roundHalfUp(13, 2, 0)).toBe(7); // 6.5
    expect(roundHalfUp(5, 8, 2)).toBe(0.63); // 0.625
    expect(roundHalfUp(2, 3, 2)).toBe(0.67);
    expect(roundHalfUp(67, 10, 1)).toBe(6.7);
  });

  it("爭議程度的門檻", () => {
    const make = (scores: number[], supports: number): JurorScore[] =>
      scores.map((score, i) => ({
        code: `J${String(i + 1).padStart(2, "0")}`,
        group: groupOf[`J${String(i + 1).padStart(2, "0")}`],
        score,
        would_support_award: i < supports,
        tags: ["結構"],
      }));
    const level = (scores: number[], supports: number) =>
      computeStats(make(scores, supports), GROUPS, settings.stats).controversy;
    expect(level(Array(10).fill(7), 10)).toBe("低");
    expect(level(Array(10).fill(7), 5)).toBe("高"); // 支持比例 0.5
    expect(level(Array(10).fill(7), 3)).toBe("高"); // 比例 0.3，下界算在內
    expect(level(Array(10).fill(7), 6)).toBe("高"); // 比例 0.6
    expect(level(Array(10).fill(7), 7)).toBe("低"); // 比例 0.7，上界不算（7／10 支持不是高爭議）
    expect(level(Array(10).fill(7), 2)).toBe("低");
    expect(level([6, 6, 6, 6, 6, 8, 8, 8, 8, 8], 8)).toBe("中"); // 標準差 1.0
    expect(level([3, 3, 3, 3, 3, 9, 9, 9, 9, 9], 10)).toBe("高"); // 標準差 3
  });

  it("沒有成功的陪審員時不計算", () => {
    expect(() => computeStats([], GROUPS, settings.stats)).toThrow();
  });
});
