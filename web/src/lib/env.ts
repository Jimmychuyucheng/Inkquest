// 環境變數的集中存取。金鑰只在伺服器端讀取，不會傳到瀏覽器。

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** Supabase 是否已經設定好（還沒設定時，頁面會顯示設定說明而不是出錯）。 */
export function supabaseConfigured(): boolean {
  return SUPABASE_URL !== "" && SUPABASE_PUBLISHABLE_KEY !== "";
}

/** service role 金鑰：只能在伺服器端使用。 */
export function serviceRoleKey(): string {
  if (typeof window !== "undefined") {
    throw new Error("service role 金鑰不可在瀏覽器端使用");
  }
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  if (key === "") throw new Error("缺少 SUPABASE_SECRET_KEY");
  return key;
}
