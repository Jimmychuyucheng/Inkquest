// 後台與月費用警戒線的伺服器端查詢。只能在伺服器使用（service role）。
import { dayStartUtc } from "@/lib/core/quota";
import { settings } from "@/lib/core/shared";
import {
  budgetLevel,
  monthStartUtc,
  summarizeUsage,
  usageSchema,
  type BudgetLevel,
  type UsageSummary,
} from "@/lib/core/usage";
import { createAdminClient } from "@/lib/supabase/admin";

/** 資料庫 settings 表中可由後台調整的數值；沒有設定時用 settings.yaml 的初始值。 */
export interface LiveSettings {
  daily_quota_per_user: number;
  global_daily_limit: number;
  monthly_budget_usd: number;
}

export async function getLiveSettings(): Promise<LiveSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("settings").select("key, value");
  if (error) throw new Error("讀取設定失敗");
  const map = new Map((data ?? []).map((row) => [row.key as string, Number(row.value)]));
  const pick = (key: keyof LiveSettings) => {
    const value = map.get(key);
    return value !== undefined && Number.isFinite(value) ? value : settings.web[key];
  };
  return {
    daily_quota_per_user: pick("daily_quota_per_user"),
    global_daily_limit: pick("global_daily_limit"),
    monthly_budget_usd: pick("monthly_budget_usd"),
  };
}

export async function getUsage(since: Date): Promise<UsageSummary> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_usage", { p_since: since.toISOString() });
  if (error) throw new Error("讀取用量失敗");
  return summarizeUsage(usageSchema.parse(data), settings.pricing);
}

export interface BudgetStatus {
  level: BudgetLevel;
  costUsd: number;
  budgetUsd: number;
}

/** 本月（台北時間）估算費用與警戒狀態。 */
export async function getBudgetStatus(now = new Date()): Promise<BudgetStatus> {
  const [usage, live] = await Promise.all([getUsage(monthStartUtc(now, settings.web.timezone)), getLiveSettings()]);
  const costUsd = usage.total.costUsd;
  return {
    level: budgetLevel(costUsd, live.monthly_budget_usd, settings.web.budget_warn_ratio),
    costUsd,
    budgetUsd: live.monthly_budget_usd,
  };
}

export interface AdminOverview {
  today: UsageSummary;
  month: UsageSummary;
  totalUsers: number;
  settings: LiveSettings;
  budget: BudgetStatus;
}

export async function getAdminOverview(now = new Date()): Promise<AdminOverview> {
  const admin = createAdminClient();
  const tz = settings.web.timezone;
  const [today, month, live, users] = await Promise.all([
    getUsage(dayStartUtc(now, tz)),
    getUsage(monthStartUtc(now, tz)),
    getLiveSettings(),
    admin.from("profiles").select("id", { count: "exact", head: true }),
  ]);
  const costUsd = month.total.costUsd;
  return {
    today,
    month,
    totalUsers: users.count ?? 0,
    settings: live,
    budget: {
      level: budgetLevel(costUsd, live.monthly_budget_usd, settings.web.budget_warn_ratio),
      costUsd,
      budgetUsd: live.monthly_budget_usd,
    },
  };
}
