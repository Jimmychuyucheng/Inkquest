// 字數計算與投稿檢查（PRD 第 3 節 B-4）。與 research/court/text.py 的結果必須一致。
import type { Settings } from "./shared";

/** 字數不含空白與換行。 */
export function countChars(text: string): number {
  return Array.from(text.replace(/\s/gu, "")).length;
}

/** 行數以非空白行計（新詩用）。 */
export function countLines(text: string): number {
  return text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== "").length;
}

/** 檢查文類與字數。回傳白話的問題清單；空陣列表示可以送出。 */
export function checkSubmission(genre: string, content: string, settings: Settings): string[] {
  const rule = settings.genres[genre];
  if (!rule) {
    return [`沒有「${genre}」這個文類，請從 ${Object.keys(settings.genres).join("、")} 中選一個。`];
  }
  const problems: string[] = [];
  const chars = countChars(content);
  if (chars < rule.min_chars) {
    problems.push(`${genre}至少需要 ${rule.min_chars} 字，目前是 ${chars} 字，請再多寫一些。`);
  }
  if (chars > rule.max_chars) {
    problems.push(`${genre}最多 ${rule.max_chars} 字，目前是 ${chars} 字，請刪減後再試。`);
  }
  if (rule.max_lines != null) {
    const lines = countLines(content);
    if (lines > rule.max_lines) {
      problems.push(`${genre}最多 ${rule.max_lines} 行，目前是 ${lines} 行，請刪減後再試。`);
    }
  }
  return problems;
}
