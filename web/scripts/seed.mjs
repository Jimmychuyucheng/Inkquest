// 把 shared/ 的人設與額度初始值寫進資料庫（npm run seed）。
// 可以重複執行：人設會更新成 shared/personas.yaml 的內容；
// 額度設定只在資料庫還沒有該項時才寫入，不會蓋掉後台改過的數值。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { parse } from "yaml";
import { loadEnv } from "./env.mjs";

const env = loadEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
const sharedDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "shared");
const readYaml = (name) => parse(readFileSync(join(sharedDir, name), "utf8"));

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const personas = readYaml("personas.yaml").personas.map((p) => ({
  code: p.code,
  name: p.name,
  group_name: p.group,
  background: p.background,
  focus: p.focus,
  tone: p.tone,
  voice_traits: p.voice_traits,
  vocabulary_rule: p.vocabulary_rule,
  enabled: p.enabled,
  version: p.version,
  updated_at: new Date().toISOString(),
}));
const { error: personaError } = await supabase.from("personas").upsert(personas, { onConflict: "code" });
if (personaError) {
  console.error("寫入人設失敗。請確認已經在 Supabase 執行過 supabase/migrations/0001_init.sql。", personaError.message);
  process.exit(1);
}
console.log(`已寫入 ${personas.length} 位陪審員人設`);

const web = readYaml("settings.yaml").web;
const defaults = {
  daily_quota_per_user: web.daily_quota_per_user,
  global_daily_limit: web.global_daily_limit,
  stale_minutes: web.stale_minutes,
  rate_limit_per_minute: web.rate_limit_per_minute,
  monthly_budget_usd: web.monthly_budget_usd,
};
const rows = Object.entries(defaults).map(([key, value]) => ({ key, value }));
const { error: settingsError } = await supabase
  .from("settings")
  .upsert(rows, { onConflict: "key", ignoreDuplicates: true });
if (settingsError) {
  console.error("寫入設定失敗：", settingsError.message);
  process.exit(1);
}
console.log(`已寫入額度初始值（已存在的項目不會被覆蓋）：${Object.keys(defaults).join("、")}`);

// 管理者：ADMIN_EMAILS 列出的帳號設為 role = admin（只會升級，不會把別人降級）
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
if (adminEmails.length === 0) {
  console.log("沒有設定 ADMIN_EMAILS，略過管理者設定。");
} else {
  for (const email of adminEmails) {
    const { data, error } = await supabase.from("profiles").update({ role: "admin" }).ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).select("id");
    if (error) {
      console.error("設定管理者失敗：", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) {
      console.log(`找不到 ${email} 的帳號：請先用這個 Google 帳號登入網站一次，再重新執行 npm run seed。`);
    } else {
      console.log(`已將 ${email} 設為管理者`);
    }
  }
}
