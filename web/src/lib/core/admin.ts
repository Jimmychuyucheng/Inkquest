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
