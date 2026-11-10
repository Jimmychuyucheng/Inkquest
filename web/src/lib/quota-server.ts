// 向資料庫查詢額度狀態（伺服器端）。
import type { QuotaStatus } from "@/lib/core/quota";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getQuotaStatus(userId: string): Promise<QuotaStatus | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_quota_status", { p_user_id: userId });
  if (error || !data) return null;
  return {
    used: data.used,
    limit: data.limit,
    remaining: data.remaining,
    globalUsed: data.global_used,
    globalLimit: data.global_limit,
    inProgress: data.in_progress,
  };
}
