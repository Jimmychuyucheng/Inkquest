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
