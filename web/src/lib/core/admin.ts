// 後台額度設定的格式檢查（PRD E-2）。伺服器端一定會檢查，不只靠前端。
import { z } from "zod";

// PostgreSQL integer 的上限；只是型別保護，不是業務上的額度上限
const PG_INT_MAX = 2_147_483_647;
const count = z.number().int().min(0).max(PG_INT_MAX);

/** 全站設定：每人每日預設次數、全站每日上限。可以只改其中一項。 */
export const settingsUpdateSchema = z
  .strictObject({
    daily_quota_per_user: count.optional(),
    global_daily_limit: count.optional(),
  })
  .refine((v) => Object.keys(v).length > 0);

/** 個別使用者額度：數字表示指定次數；null 表示改回全站預設。 */
export const userQuotaSchema = z.strictObject({
  daily_quota_override: count.nullable(),
});

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

/** 後台「註冊帳號」列表的一列。 */
export interface AccountRow {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  submissions: number;
  researchConsent: boolean;
  quotaOverride: number | null;
}

export interface ProfileRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  created_at: string;
  daily_quota_override: number | null;
  research_consent_at: string | null;
}

/** 合併 profiles、登入紀錄與投稿數，依註冊時間由新到舊排序。 */
export function buildAccountRows(
  profiles: readonly ProfileRow[],
  lastSignIn: Readonly<Record<string, string | null | undefined>>,
  submissionUserIds: readonly string[],
): AccountRow[] {
  const counts = new Map<string, number>();
  for (const id of submissionUserIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return profiles
    .map((p) => ({
      id: p.id,
      email: p.email,
      name: p.display_name ?? "",
      isAdmin: p.role === "admin",
      createdAt: p.created_at,
      lastSignInAt: lastSignIn[p.id] ?? null,
      submissions: counts.get(p.id) ?? 0,
      researchConsent: p.research_consent_at !== null,
      quotaOverride: p.daily_quota_override,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
