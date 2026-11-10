// 匯出投稿統計（PRD E-6，供使用者研究）。只在伺服器端使用。
// 每筆投稿一列；不含文章全文、標題與 email。使用者以匿名代號表示。
import { createHash } from "node:crypto";
import { GROUPS, personas } from "./shared";

export interface ExportJuror {
  juror_code: string;
  status: string;
  score: number | null;
}

/** 從資料庫讀出的一筆投稿（只選匯出需要的欄位，不讀 content 與 title）。 */
export interface ExportSubmission {
  user_id: string;
  genre: string;
  char_count: number;
  modules: string[];
  status: string;
  jurors_ok: number;
  stats: {
    mean_score?: number;
    support_ratio?: number;
    group_means?: Record<string, number | null>;
    controversy?: string;
  } | null;
  created_at: string;
  finished_at: string | null;
  research_consent: boolean;
  juror_results: ExportJuror[];
}

export const JUROR_CODES = personas.map((p) => p.code).sort();

export const EXPORT_COLUMNS = [
  "user_code",
  "genre",
  "char_count",
  "modules",
  "status",
  "jurors_ok",
  "mean_score",
  "support_ratio",
  ...GROUPS.map((g) => `group_mean_${g}`),
  "controversy",
  ...JUROR_CODES,
  "created_at",
  "finished_at",
  "research_consent",
];

/** 匿名使用者代號：user id 的 sha256 前 10 碼。同一人每次匯出都一樣，但看不出是誰。 */
export function anonymousCode(userId: string): string {
  return `U${createHash("sha256").update(userId).digest("hex").slice(0, 10)}`;
}

/** ISO 時間 → 指定時區的「YYYY-MM-DD HH:mm:ss」。 */
export function formatLocal(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportRow(s: ExportSubmission, timeZone: string): string[] {
  const scores = new Map(
    s.juror_results.filter((j) => j.status === "ok" && j.score !== null).map((j) => [j.juror_code, j.score]),
  );
  const stats = s.stats ?? {};
  return [
    anonymousCode(s.user_id),
    s.genre,
    s.char_count,
    s.modules.join("|"),
    s.status,
    s.jurors_ok,
    stats.mean_score,
    stats.support_ratio,
    ...GROUPS.map((g) => stats.group_means?.[g]),
    stats.controversy,
    ...JUROR_CODES.map((code) => scores.get(code)),
    formatLocal(s.created_at, timeZone),
    formatLocal(s.finished_at, timeZone),
    s.research_consent,
  ].map(cell);
}

/** 產生 CSV 文字。開頭加 BOM，Excel 打開才不會亂碼。 */
export function buildCsv(rows: ExportSubmission[], timeZone: string): string {
  const lines = [EXPORT_COLUMNS.map(cell).join(","), ...rows.map((r) => exportRow(r, timeZone).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
