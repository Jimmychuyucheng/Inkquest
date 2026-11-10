// 模型輸出的 JSON 格式（PRD 第 5 節），用 zod 驗證。
// 與 research/court/schemas.py 對應；欄位清單由測試對照 shared/schemas/*.json。
import { z } from "zod";
import type { Settings } from "./shared";
import { countChars } from "./text";

export const TAGS = [
  "意象", "結構", "節奏", "人物", "情感", "題材",
  "語言", "開頭", "結尾", "真實感", "可讀性", "原創性",
] as const;

const pointSchema = z.strictObject({
  point: z.string().min(1),
  quote: z.string(),
});

export const jurorOutputSchema = z.strictObject({
  characters_in_text: z.array(z.string().min(1)).max(10),
  score: z.number().int().min(0).max(10),
  would_support_award: z.boolean(),
  one_line: z.string().min(1),
  comment: z.string().min(1),
  strengths: z.array(pointSchema).min(1).max(3),
  weaknesses: z.array(pointSchema).min(1).max(3),
  tags: z
    .array(z.enum(TAGS))
    .min(1)
    .max(3)
    .refine((tags) => new Set(tags).size === tags.length, { message: "tags 不可重複" }),
});
export type JurorOutput = z.infer<typeof jurorOutputSchema>;

export const judgeOutputSchema = z.strictObject({
  headline: z.string().min(1),
  verdict: z.string().min(1),
  minority_opinion: z.string().min(1),
  minority_jurors: z.array(z.string().regex(/^J\d{2}$/)),
  biggest_disagreement: z.string().min(1),
  top_strengths: z.array(z.string().min(1)).min(1).max(3),
  top_weaknesses: z.array(z.string().min(1)).min(1).max(3),
  author_wellbeing_flag: z.boolean(),
});
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;

/** 模型輸出不合格。message 是可以直接回饋給模型、讓它照著修正的中文說明。 */
export class OutputInvalid extends Error {}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const loc = issue.path.join(".") || "(整體)";
      if (issue.code === "too_big" && issue.origin === "array") return `${loc} 最多只能 ${issue.maximum} 項`;
      if (issue.code === "too_small" && issue.origin === "array") return `${loc} 至少要 ${issue.minimum} 項`;
      if (issue.code === "unrecognized_keys") return `多了不該有的欄位：${issue.keys.join("、")}`;
      if (issue.code === "invalid_type" && issue.input === undefined) return `缺少 ${loc} 欄位`;
      if (issue.code === "invalid_value") return `${loc} 不在允許的清單內`;
      return `${loc}：${issue.message}`;
    })
    .join("；");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new OutputInvalid("輸出不是合法的 JSON");
  }
}

function tooLong(name: string, text: string, max: number, tol: number): string | null {
  const length = countChars(text);
  return length > max * (1 + tol) ? `${name} 寫了 ${length} 字，請縮短到 ${max} 字以內` : null;
}

function tooShort(name: string, text: string, min: number, tol: number): string | null {
  const length = countChars(text);
  return length < min * (1 - tol) ? `${name} 只寫了 ${length} 字，請增加到 ${min} 字以上` : null;
}

/** 字數檢查；超出規定 20%（length_tolerance）以內可接受。 */
export function checkJurorLengths(output: JurorOutput, limits: Settings["juror_output"]): string[] {
  const tol = limits.length_tolerance;
  return [
    tooLong("one_line", output.one_line, limits.one_line_max, tol),
    tooShort("comment", output.comment, limits.comment_min, tol),
    tooLong("comment", output.comment, limits.comment_max, tol),
  ].filter((p): p is string => p !== null);
}

export function parseJurorOutput(text: string, settings: Settings): JurorOutput {
  const result = jurorOutputSchema.safeParse(parseJson(text));
  if (!result.success) throw new OutputInvalid(`JSON 格式不符：${describeIssues(result.error)}`);
  const problems = checkJurorLengths(result.data, settings.juror_output);
  if (problems.length > 0) throw new OutputInvalid(`字數不符：${problems.join("；")}`);
  return result.data;
}

/** 文字中提到的陪審員編號（不重複，依出現順序）。 */
export function citedJurors(text: string): string[] {
  return [...new Set(text.match(/J\d{2}/g) ?? [])];
}

/** 法官輸出的字數、引用與禁用字眼檢查。juryGroups：本次成功評閱的陪審員編號 → 組別。 */
export function checkJudgeOutput(
  output: JudgeOutput,
  limits: Settings["judge_output"],
  juryGroups: Record<string, string>,
): string[] {
  const tol = limits.length_tolerance;
  const problems = [
    tooLong("headline", output.headline, limits.headline_max, tol),
    tooShort("verdict", output.verdict, limits.verdict_min, tol),
    tooLong("verdict", output.verdict, limits.verdict_max, tol),
    tooShort("minority_opinion", output.minority_opinion, limits.minority_min, tol),
    tooLong("minority_opinion", output.minority_opinion, limits.minority_max, tol),
    tooLong("biggest_disagreement", output.biggest_disagreement, limits.disagreement_max, tol),
  ].filter((p): p is string => p !== null);

  const cited = citedJurors(output.verdict);
  const unknown = cited.filter((code) => !(code in juryGroups));
  if (unknown.length > 0) problems.push(`verdict 引用了不在本次陪審團的編號：${unknown.join("、")}`);
  const valid = cited.filter((code) => code in juryGroups);
  if (valid.length < limits.min_cited_jurors) {
    problems.push(`verdict 只引用了 ${valid.length} 位陪審員，至少要 ${limits.min_cited_jurors} 位並標明編號`);
  }
  const groupsNeeded = Math.min(limits.min_cited_jurors, new Set(Object.values(juryGroups)).size);
  const groupsCited = new Set(valid.map((code) => juryGroups[code]));
  if (groupsCited.size < groupsNeeded) {
    problems.push(`verdict 引用的陪審員只來自 ${groupsCited.size} 個組別，需要涵蓋 ${groupsNeeded} 個組別`);
  }

  const fields: Record<string, string> = {
    headline: output.headline,
    verdict: output.verdict,
    minority_opinion: output.minority_opinion,
    biggest_disagreement: output.biggest_disagreement,
    top_strengths: output.top_strengths.join("\n"),
    top_weaknesses: output.top_weaknesses.join("\n"),
  };
  for (const [name, text] of Object.entries(fields)) {
    const used = limits.banned_words.filter((word) => text.includes(word));
    if (used.length > 0) {
      problems.push(`${name} 用了「${used.join("」「")}」，判決不預測比賽結果，請改用「支持／不支持」等說法`);
    }
  }

  const unknownMinority = output.minority_jurors.filter((code) => !(code in juryGroups));
  if (unknownMinority.length > 0) {
    problems.push(`minority_jurors 有不在本次陪審團的編號：${unknownMinority.join("、")}`);
  }
  return problems;
}

export function parseJudgeOutput(
  text: string,
  settings: Settings,
  juryGroups: Record<string, string>,
): JudgeOutput {
  const result = judgeOutputSchema.safeParse(parseJson(text));
  if (!result.success) throw new OutputInvalid(`JSON 格式不符：${describeIssues(result.error)}`);
  const problems = checkJudgeOutput(result.data, settings.judge_output, juryGroups);
  if (problems.length > 0) throw new OutputInvalid(problems.join("；"));
  return result.data;
}
