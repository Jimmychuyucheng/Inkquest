// 後台：以 email 搜尋使用者，顯示今日用量與個別額度（PRD E-2）。
import { NextResponse, type NextRequest } from "next/server";
import { adminGuard } from "@/lib/admin-api";
import { copy } from "@/lib/copy";
import { getQuotaStatus } from "@/lib/quota-server";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_RESULTS = 20;

export async function GET(request: NextRequest) {
  const denied = await adminGuard();
  if (denied) return denied;

  const query = (request.nextUrl.searchParams.get("email") ?? "").trim();
  if (query === "") return NextResponse.json({ users: [] });
  // ilike 的萬用字元要跳脫，避免輸入 % 就列出所有人
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, email, display_name, role, daily_quota_override")
    .ilike("email", pattern)
    .order("email")
    .limit(MAX_RESULTS);
  if (error) return NextResponse.json({ message: copy.admin.loadFailed }, { status: 500 });

  const users = await Promise.all(
    (data ?? []).map(async (u) => {
      const quota = await getQuotaStatus(u.id);
      return { ...u, used_today: quota?.used ?? 0, limit_today: quota?.limit ?? 0 };
    }),
  );
  return NextResponse.json({ users });
}
