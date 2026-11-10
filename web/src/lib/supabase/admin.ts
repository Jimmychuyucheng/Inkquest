// 伺服器專用的 Supabase 連線（service role，不受 RLS 限制）。
// 只能在 API 路由與背景工作中使用，使用前一定要先確認呼叫者的身分。
// 不可以從任何 "use client" 的檔案 import。
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, serviceRoleKey } from "@/lib/env";

export function createAdminClient() {
  return createClient(SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
