// 伺服器端的 Supabase 連線（帶著使用者的登入 cookie，權限受 RLS 限制）。
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // 在 Server Component 裡不能寫 cookie；登入狀態的更新由 proxy.ts 負責，這裡可以略過
        }
      },
    },
  });
}
