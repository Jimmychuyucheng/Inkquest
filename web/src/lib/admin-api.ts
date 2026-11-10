// 後台 API 共用：先確認呼叫者是管理者，否則回傳白話錯誤。
import { NextResponse } from "next/server";
import { checkAdminApi } from "@/lib/auth";
import { copy } from "@/lib/copy";

/** 是管理者回傳 null；不是就回傳應該直接送出的回應。 */
export async function adminGuard(): Promise<NextResponse | null> {
  const result = await checkAdminApi();
  if ("user" in result) return null;
  const message = result.status === 401 ? copy.admin.notLoggedIn : copy.admin.notAdmin;
  return NextResponse.json({ message }, { status: result.status });
}
