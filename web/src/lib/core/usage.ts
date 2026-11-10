// 用量與費用的純邏輯（PRD E-1、第 10 節月費用警戒線）。
// token 總數由資料庫的 admin_usage 函式加總；單價來自 shared/settings.yaml 的 pricing。
import { z } from "zod";
import { dayStartUtc } from "./quota";
import type { Settings } from "./shared";

export const SOURCES = ["juror", "judge", "advice"] as const;
export type Source = (typeof SOURCES)[number];

const tokenRowSchema = z.object({
  source: z.enum(SOURCES),
  model: z.string(),
  calls: z.coerce.number(),
  input_tokens: z.coerce.number(),
  output_tokens: z.coerce.number(),
});

export const usageSchema = z.object({
  submissions: z.record(z.string(), z.coerce.number()),
  active_users: z.coerce.number(),
  tokens: z.array(tokenRowSchema),
});

export type TokenRow = z.infer<typeof tokenRowSchema>;
export type RawUsage = z.infer<typeof usageSchema>;

export interface SourceTotal {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageSummary {
  submissions: { total: number; done: number; failed: number; inProgress: number };
  activeUsers: number;
  bySource: Record<Source, SourceTotal>;
  total: SourceTotal;
  /** 單價表裡找不到的模型（例如假資料模式的 mock），費用以 0 計 */
  unpricedModels: string[];
}

/** 單一模型的費用（美元）。找不到單價時回傳 null。 */
export function rowCost(row: Pick<TokenRow, "model" | "input_tokens" | "output_tokens">, pricing: Settings["pricing"]): number | null {
  const price = pricing[row.model];
  if (!price) return null;
  return (row.input_tokens * price.input_per_mtok + row.output_tokens * price.output_per_mtok) / 1_000_000;
}

function emptyTotal(): SourceTotal {
  return { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

export function summarizeUsage(raw: RawUsage, pricing: Settings["pricing"]): UsageSummary {
  const bySource = { juror: emptyTotal(), judge: emptyTotal(), advice: emptyTotal() };
  const total = emptyTotal();
  const unpriced = new Set<string>();
  for (const row of raw.tokens) {
    const cost = rowCost(row, pricing);
    if (cost === null) unpriced.add(row.model);
    for (const target of [bySource[row.source], total]) {
      target.calls += row.calls;
      target.inputTokens += row.input_tokens;
      target.outputTokens += row.output_tokens;
      target.costUsd += cost ?? 0;
    }
  }
  const count = (status: string) => raw.submissions[status] ?? 0;
  const all = Object.values(raw.submissions).reduce((sum, n) => sum + n, 0);
  return {
    submissions: {
      total: all,
      done: count("done"),
      failed: count("failed"),
      inProgress: all - count("done") - count("failed"),
    },
    activeUsers: raw.active_users,
    bySource,
    total,
    unpricedModels: [...unpriced].sort(),
  };
}

export type BudgetLevel = "ok" | "warn" | "paused";

/** 月費用警戒線：達 warnRatio（settings.web.budget_warn_ratio）警示，達 100% 暫停投稿。 */
export function budgetLevel(costUsd: number, budgetUsd: number, warnRatio: number): BudgetLevel {
  // 以百萬分之一美元的整數比較，避免 12 × 0.8 = 9.600000000000001 這類浮點誤差讓邊界判斷錯
  const micro = (usd: number) => Math.round(usd * 1_000_000);
  if (budgetUsd <= 0) return "paused";
  if (micro(costUsd) >= micro(budgetUsd)) return "paused";
  if (micro(costUsd) >= micro(budgetUsd * warnRatio)) return "warn";
  return "ok";
}

/** 指定時區「本月 1 日 00:00」對應的 UTC 時間。 */
export function monthStartUtc(now: Date, timeZone: string): Date {
  const day = Number(new Intl.DateTimeFormat("en-CA", { timeZone, day: "numeric" }).format(now));
  // 先找到今天 00:00，再往回 (day - 1) 天；中午取日期可避開時差造成的跨日誤差
  const todayStart = dayStartUtc(now, timeZone);
  const noonOfFirst = new Date(todayStart.getTime() - (day - 1) * 86_400_000 + 12 * 3_600_000);
  return dayStartUtc(noonOfFirst, timeZone);
}

export function formatUsd(value: number): string {
  return `US$${value.toFixed(value < 1 ? 4 : 2)}`;
}
