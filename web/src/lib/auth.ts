// 登入身分與權限檢查（伺服器端）。
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { supabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: "user" | "admin";
  terms_accepted_at: string | null;
  research_consent: boolean;
}

export interface CurrentUser {
  id: string;
  email: string;
  avatarUrl: string | null;
  profile: Profile | null;
}

/** 目前登入的使用者；沒登入回傳 null。身分由 Supabase 伺服器驗證，不直接相信 cookie。 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  // 登入狀態每個請求都不同：一律在請求當下才算，不可以在建置時先算好存起來
  await connection();
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, display_name, role, terms_accepted_at, research_consent")
    .eq("id", data.user.id)
    .maybeSingle();
  return {
    id: data.user.id,
    email: data.user.email ?? "",
    avatarUrl: (data.user.user_metadata?.avatar_url as string | undefined) ?? null,
    profile: (profile as Profile | null) ?? null,
  };
}

/** 需要登入的頁面使用：沒登入導回首頁。 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}

/** 需要登入且已同意條款的頁面使用（PRD A-1、A-2）。 */
export async function requireTermsAccepted(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.profile?.terms_accepted_at) redirect("/terms");
  return user;
}

/** 管理者專用頁面使用（PRD 第 10 節）：不是管理者就導回首頁。 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.profile?.role !== "admin") redirect("/");
  return user;
}

/**
 * 後台 API 使用：回傳管理者，或回傳應該直接回應的錯誤狀態（401 沒登入、403 不是管理者）。
 * role 是從資料庫讀的，使用者自己改不了（profiles 沒有開放更新）。
 */
export async function checkAdminApi(): Promise<{ user: CurrentUser } | { status: 401 | 403 }> {
  const user = await getCurrentUser();
  if (!user) return { status: 401 };
  if (user.profile?.role !== "admin") return { status: 403 };
  return { user };
}
