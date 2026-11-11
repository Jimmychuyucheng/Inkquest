// 結果頁的純邏輯（PRD 第 3、7 節）：模組顯示規則、判決文字切分、日期格式。
import type { Group } from "./shared";

export const MODULES = ["verdict", "jurors", "scores", "advice"] as const;
export type ModuleName = (typeof MODULES)[number];

export interface ModuleView {
  /** 法官總評永遠顯示（D-1）。 */
  verdict: true;
  /** 陪審員卡片是否預設展開；沒勾選時仍可用按鈕點開（D-2）。 */
  jurorsOpen: boolean;
  scores: boolean;
  advice: boolean;
  /** 還沒勾選、可以用「也想看…」補上的模組（D-4）。 */
  addable: ModuleName[];
}

export function moduleView(selected: readonly string[]): ModuleView {
  const has = (name: ModuleName) => selected.includes(name);
  return {
    verdict: true,
    jurorsOpen: has("jurors"),
    scores: has("scores"),
    advice: has("advice"),
    addable: MODULES.filter((name) => name !== "verdict" && !has(name)),
  };
}

export type TextSegment = { type: "text"; text: string } | { type: "juror"; code: string };

/**
 * 把判決書切成文字與陪審員編號，讓編號可以點擊跳到該卡片（PRD 第 7 節）。
 * 只有本次陪審團內的編號會變成連結，其他照原樣顯示。
 */
export function splitByJurorCodes(text: string, juryCodes: readonly string[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let buffer = "";
  for (const part of text.split(/(J\d{2})/)) {
    if (/^J\d{2}$/.test(part) && juryCodes.includes(part)) {
      if (buffer) segments.push({ type: "text", text: buffer });
      buffer = "";
      segments.push({ type: "juror", code: part });
    } else {
      buffer += part;
    }
  }
  if (buffer) segments.push({ type: "text", text: buffer });
  return segments;
}

/** 組別 → 識別色的名稱（對應 globals.css 的 --group-*）。 */
export function groupColor(group: Group | string): "pro" | "lay" | "cross" {
  if (group === "文學專業") return "pro";
  if (group === "一般讀者") return "lay";
  return "cross";
}

/** 以指定時區顯示日期時間，例如 2026/11/10 23:56。 */
export function formatDateTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

interface VerdictText {
  headline: string;
  verdict: string;
  minority_opinion: string;
  biggest_disagreement: string;
}

/** 「複製法官總評」按鈕複製的文字（D-7）。結尾附上免責聲明。 */
export function verdictCopyText(title: string, verdict: VerdictText, disclaimer: string): string {
  return [
    `《${title || "未命名"}》`,
    verdict.headline,
    "",
    "【法官總評】",
    verdict.verdict,
    "",
    "【少數意見書】",
    verdict.minority_opinion,
    "",
    "【最大分歧】",
    verdict.biggest_disagreement,
    "",
    disclaimer,
  ].join("\n");
}

/** 平均分顯示到小數一位（7 → 7.0）。 */
export function formatScore(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(1) : "—";
}

/** 支持比例 0.7 → 70%。 */
export function formatRatio(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * 把一段文字切成句子：在「。！？」之後切開，但引號（「」『』）裡面的不切。
 * 換行也當作句子的分界。
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let buffer = "";
  let depth = 0;
  for (const char of text) {
    if (char === "「" || char === "『") depth += 1;
    if ((char === "」" || char === "』") && depth > 0) depth -= 1;
    if (char === "\n") {
      if (buffer.trim()) sentences.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += char;
    if (depth === 0 && /[。！？!?]/.test(char)) {
      sentences.push(buffer.trim());
      buffer = "";
    }
  }
  if (buffer.trim()) sentences.push(buffer.trim());
  return sentences;
}

const GROUP_NOTE = /[（(](?:文學專業|一般讀者|跨界視角)(?:組)?[）)]/g;

/**
 * 把句子裡的陪審員編號換成職業名稱，讓不熟編號的人也讀得懂：
 * 「J02小說家認為」→「小說家認為」、「小說家（J02）認為」→「小說家認為」、
 * 「J05、J11 皆指出」→「國文老師、高中生皆指出」、「J14老闆」→「中小企業老闆」。組別註記（「（文學專業）」）一併拿掉，畫面上用顏色表示組別。
 * 只處理本次陪審團內的編號。
 */
export function readableSentence(sentence: string, juryCodes: readonly string[], nameOf: (code: string) => string): string {
  let result = "";
  let rest = sentence;
  const pattern = /J\d{2}/;
  for (let match = pattern.exec(rest); match; match = pattern.exec(rest)) {
    const code = match[0];
    let before = rest.slice(0, match.index);
    let after = rest.slice(match.index + code.length);
    if (!juryCodes.includes(code)) {
      result += before + code;
      rest = after;
      continue;
    }
    const name = nameOf(code);
    const afterTrimmed = after.replace(/^\s+/, "");
    const wrapped = /[（(]\s*$/.test(before) && /^\s*[）)]/.test(after);
    if (wrapped && before.replace(/[（(]\s*$/, "").endsWith(name)) {
      // 小說家（J02）→ 小說家
      before = before.replace(/[（(]\s*$/, "");
      after = after.replace(/^\s*[）)]/, "");
      result += before;
    } else if (afterTrimmed.startsWith(name)) {
      // J02 小說家 → 小說家
      result += before;
      after = afterTrimmed;
    } else if (shortNameLength(afterTrimmed, name) > 0) {
      // 法官用了簡稱：J14老闆 → 中小企業老闆、J17總舖師 → 辦桌總舖師
      result += before + name;
      after = afterTrimmed.slice(shortNameLength(afterTrimmed, name));
    } else {
      result += before + name;
    }
    rest = after;
  }
  return (result + rest).replace(GROUP_NOTE, "").replace(/\s+([，。、；：！？])/g, "$1");
}

/** text 開頭是不是 name 的後半段（至少 2 個字，例如「中小企業老闆」的「老闆」）；是的話回傳長度，否則 0。 */
function shortNameLength(text: string, name: string): number {
  for (let start = 1; start <= name.length - 2; start += 1) {
    const suffix = name.slice(start);
    if (text.startsWith(suffix)) return suffix.length;
  }
  return 0;
}

export interface VerdictMention {
  code: string;
  /** 判決書中提到這位陪審員的句子（已把編號換成職業名稱） */
  sentences: string[];
}

/** 依「；」切成子句（引號裡的不切），保留分號。 */
function splitClauses(sentence: string): string[] {
  const clauses: string[] = [];
  let buffer = "";
  let depth = 0;
  for (const char of sentence) {
    if (char === "「" || char === "『") depth += 1;
    if ((char === "」" || char === "』") && depth > 0) depth -= 1;
    buffer += char;
    if (depth === 0 && (char === "；" || char === ";")) {
      clauses.push(buffer);
      buffer = "";
    }
  }
  if (buffer) clauses.push(buffer);
  return clauses;
}

const codesIn = (text: string, juryCodes: readonly string[]) =>
  [...new Set(text.match(/J\d{2}/g) ?? [])].filter((code) => juryCodes.includes(code));

/**
 * 法官總評圖像化用：找出判決書提到的每一位陪審員，以及提到他的那段話。
 * 一句裡用「；」分別講不同陪審員時，每位只拿到講自己的那段；沒有編號的子句接在前一段後面。
 * 依第一次被提到的順序排列；同一段提到多位時（「J05、J11 皆指出…」），每一位都會列出這段。
 */
export function verdictMentions(text: string, juryCodes: readonly string[], nameOf: (code: string) => string): VerdictMention[] {
  const byCode = new Map<string, string[]>();
  const add = (codes: string[], raw: string) => {
    let piece = raw.trim().replace(/[；;]$/, "");
    if (!/[。！？!?]$/.test(piece)) piece += "。";
    const readable = readableSentence(piece, juryCodes, nameOf);
    for (const code of codes) {
      const list = byCode.get(code) ?? [];
      if (!list.includes(readable)) list.push(readable);
      byCode.set(code, list);
    }
  };
  for (const sentence of splitSentences(text)) {
    let current: { codes: string[]; text: string } | null = null;
    for (const clause of splitClauses(sentence)) {
      const codes = codesIn(clause, juryCodes);
      if (codes.length > 0) {
        if (current) add(current.codes, current.text);
        current = { codes, text: clause };
      } else if (current) {
        current.text += clause;
      }
    }
    if (current) add(current.codes, current.text);
  }
  return [...byCode].map(([code, sentences]) => ({ code, sentences }));
}
