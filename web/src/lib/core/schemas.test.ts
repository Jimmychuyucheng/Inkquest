// JSON 驗證的測試（CLAUDE.md 規定一定要有）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OutputInvalid,
  TAGS,
  judgeOutputSchema,
  jurorOutputSchema,
  parseJudgeOutput,
  parseJurorOutput,
} from "./schemas";
import { settings } from "./shared";

const readSchema = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../../shared/schemas/${name}.schema.json`, import.meta.url)), "utf8"),
  );

const validJuror = () => ({
  characters_in_text: ["我", "外婆"],
  score: 7,
  would_support_award: true,
  one_line: "結構紮實，結尾略急。",
  comment: "這".repeat(150),
  strengths: [{ point: "開頭具體", quote: "外婆家的後陽台" }],
  weaknesses: [{ point: "結尾收得快", quote: "" }],
  tags: ["結構", "結尾"],
});
const juror = (changes: Record<string, unknown> = {}) => JSON.stringify({ ...validJuror(), ...changes });

const GROUPS_OF = { J01: "文學專業", J02: "文學專業", J07: "一般讀者", J13: "跨界視角", J15: "跨界視角" };
const validJudge = () => ({
  headline: "細節扎實，結尾略急。",
  verdict: "J01 詩人認為開頭具體；J07 記者認為交代清楚；J13 木工老師傅認為結構穩。" + "補".repeat(230),
  minority_opinion: "少".repeat(120),
  minority_jurors: ["J15"],
  biggest_disagreement: "結尾收得快，是缺點還是節制。",
  top_strengths: ["開頭具體"],
  top_weaknesses: ["結尾太快"],
  author_wellbeing_flag: false,
});
const judge = (changes: Record<string, unknown> = {}) =>
  parseJudgeOutput(JSON.stringify({ ...validJudge(), ...changes }), settings, GROUPS_OF);

describe("欄位清單與 Python 匯出的 JSON Schema 一致", () => {
  it("陪審員", () => {
    const schema = readSchema("juror_output");
    expect(Object.keys(jurorOutputSchema.shape).sort()).toEqual([...schema.required].sort());
    expect(Object.keys(jurorOutputSchema.shape)[0]).toBe("characters_in_text");
    expect([...TAGS].sort()).toEqual([...schema.properties.tags.items.enum].sort());
  });

  it("法官", () => {
    const schema = readSchema("judge_output");
    expect(Object.keys(judgeOutputSchema.shape).sort()).toEqual([...schema.required].sort());
  });
});

describe("陪審員輸出", () => {
  it("合格的輸出通過", () => {
    expect(parseJurorOutput(juror(), settings).score).toBe(7);
    expect(parseJurorOutput(juror({ characters_in_text: [] }), settings).characters_in_text).toEqual([]);
  });

  it.each([
    ["score", 11],
    ["score", -1],
    ["score", 7.5],
    ["score", "7"],
    ["would_support_award", "true"],
    ["one_line", ""],
    ["strengths", []],
    ["weaknesses", Array(4).fill({ point: "a", quote: "" })],
    ["strengths", [{ point: "少了 quote" }]],
    ["tags", []],
    ["tags", ["不在清單裡"]],
    ["tags", ["意象", "意象"]],
    ["characters_in_text", Array(11).fill("人")],
    ["probability", 0.9],
  ])("%s = %j 被拒絕", (field, value) => {
    expect(() => parseJurorOutput(juror({ [field]: value }), settings)).toThrow(OutputInvalid);
  });

  it("不是 JSON、缺欄位時說明原因", () => {
    expect(() => parseJurorOutput("這不是 JSON", settings)).toThrow("輸出不是合法的 JSON");
    const missing: Record<string, unknown> = validJuror();
    delete missing.comment;
    expect(() => parseJurorOutput(JSON.stringify(missing), settings)).toThrow("缺少 comment 欄位");
    expect(() => parseJurorOutput(juror({ tags: ["意象", "結構", "節奏", "人物"] }), settings)).toThrow(
      "tags 最多只能 3 項",
    );
  });

  it("字數容許超出 20%，再多就退回並說明要改成幾個字", () => {
    // comment 120～250 字 → 96～300 可接受；one_line 40 字 → 48 可接受
    expect(() => parseJurorOutput(juror({ comment: "字".repeat(96) }), settings)).not.toThrow();
    expect(() => parseJurorOutput(juror({ comment: "字".repeat(300) }), settings)).not.toThrow();
    expect(() => parseJurorOutput(juror({ comment: "字".repeat(95) }), settings)).toThrow(
      "comment 只寫了 95 字，請增加到 120 字以上",
    );
    expect(() => parseJurorOutput(juror({ comment: "字".repeat(301) }), settings)).toThrow(
      "comment 寫了 301 字，請縮短到 250 字以內",
    );
    expect(() => parseJurorOutput(juror({ one_line: "字".repeat(48) }), settings)).not.toThrow();
    expect(() => parseJurorOutput(juror({ one_line: "字".repeat(49) }), settings)).toThrow(
      "one_line 寫了 49 字，請縮短到 40 字以內",
    );
  });
});

describe("法官輸出", () => {
  it("合格的輸出通過；全體一致時少數陪審員可為空", () => {
    expect(judge().minority_jurors).toEqual(["J15"]);
    expect(judge({ minority_jurors: [] }).minority_jurors).toEqual([]);
  });

  it("判決書必須引用 3 位、涵蓋不同組別、編號在本次陪審團內", () => {
    const pad = "補".repeat(240);
    expect(() => judge({ verdict: "J01 說好；J07 也說好。" + pad })).toThrow("只引用了 2 位");
    expect(() => judge({ verdict: "J01 說好；J02 也說好；J07 說還可以。" + pad })).toThrow("只來自 2 個組別");
    expect(() => judge({ verdict: "J01、J07、J13 都說好，J20 也是。" + pad })).toThrow("不在本次陪審團");
    expect(() => judge({ minority_jurors: ["J20"] })).toThrow("minority_jurors");
  });

  it("不可使用預測比賽結果的字眼", () => {
    expect(() => judge({ headline: "有潛力的入選之作" })).toThrow("headline 用了「入選」");
    expect(() => judge({ verdict: "J01、J07、J13 都支持得獎。" + "補".repeat(240) })).toThrow("verdict 用了「得獎」");
    expect(() => judge({ top_strengths: ["有獲獎的實力"] })).toThrow("top_strengths 用了「獲獎」");
  });

  it("字數與結構", () => {
    expect(() => judge({ verdict: "J01、J07、J13 都說好。" })).toThrow("verdict 只寫了");
    expect(() => judge({ headline: "長".repeat(31) })).toThrow("headline 寫了 31 字");
    expect(() => judge({ minority_opinion: "短" })).toThrow("minority_opinion 只寫了");
    expect(() => judge({ top_strengths: [] })).toThrow(OutputInvalid);
    expect(() => judge({ author_wellbeing_flag: "false" })).toThrow(OutputInvalid);
    expect(() => judge({ win_probability: 0.8 })).toThrow("多了不該有的欄位");
  });
});
