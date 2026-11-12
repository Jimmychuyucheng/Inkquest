// 後台測試（W4）：權限、用量總覽、額度調整立即生效、月費用警戒線暫停收件、匯出 CSV。
// 走真正的網站 API（登入 cookie → /admin、/api/admin/*、/api/submissions）。
// 不呼叫 AI、不花錢：投稿資料直接寫進資料庫，不經過背景工作。
// 會暫時修改 settings 表的額度與預算，結束時（包含失敗時）一定改回原值。
// 會建立並刪除兩個測試帳號。
//
// 執行前請先：在 Supabase 執行 0004、0005 的 SQL，並啟動網站（npm run dev）。
// 注意：用量紀錄表只能新增，測試產生的紀錄（假資料，0 token、0 元）會永久留著。
import { createHmac } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.mjs";

const env = loadEnv(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "RESEARCH_EXPORT_SALT"]);
const SITE = env.TEST_SITE_URL ?? "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failures += 1;
}

async function makeUser(label, { role = "user", consent = false } = {}) {
  const email = `inkquest-${label}-${Date.now()}@example.com`;
  const password = `P-${crypto.randomUUID()}`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw new Error(`建立測試帳號失敗：${made.error.message}`);
  const user = made.data.user;
  await admin
    .from("profiles")
    .update({ role, terms_accepted_at: new Date().toISOString(), research_consent: consent, research_consent_at: consent ? new Date().toISOString() : null })
    .eq("id", user.id);
  const jar = new Map();
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (items) => items.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`登入失敗：${signIn.error.message}`);
  const cookie = () => [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
  const request = (method, path, body) =>
    fetch(SITE + path, {
      method,
      headers: { cookie: cookie(), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
  return { user, email, request, client };
}

const SECRET_TEXT = "後台測試專用的晾衣竿句子";
const SECRET_TITLE = "後台測試秘密標題";

/** 直接寫入一筆已完成的投稿（不經過背景工作，不呼叫 AI）。 */
async function insertDone(userId) {
  const { data, error } = await admin
    .from("submissions")
    .insert({
      user_id: userId,
      genre: "散文",
      title: SECRET_TITLE,
      content: SECRET_TEXT + "字".repeat(300),
      char_count: 312,
      modules: ["verdict", "scores"],
      status: "done",
      jury: ["J01", "J02"],
      jurors_ok: 2,
      stats: { mean_score: 6.5, support_ratio: 0.5, group_means: { 文學專業: 6.5, 一般讀者: null, 跨界視角: null }, controversy: "高" },
      finished_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`寫入測試投稿失敗：${error.message}`);
  await admin.from("juror_results").insert([
    { submission_id: data.id, juror_code: "J01", persona_version: 1, status: "ok", output: { score: 7 }, model: "mock" },
    { submission_id: data.id, juror_code: "J02", persona_version: 1, status: "ok", output: { score: 6 }, model: "mock" },
  ]);
  return data.id;
}

const KEYS = ["daily_quota_per_user", "global_daily_limit", "monthly_budget_usd"];
let original = null;
const users = [];

try {
  // 先記下原本的設定，結束時改回去
  const { data: before, error: readError } = await admin.from("settings").select("key, value").in("key", KEYS);
  if (readError) throw new Error(`讀取 settings 失敗：${readError.message}`);
  original = before;

  const boss = await makeUser("admin", { role: "admin" });
  const member = await makeUser("member", { consent: true });
  const other = await makeUser("noconsent", { consent: false });
  users.push(boss.user, member.user, other.user);

  console.log("權限");
  let res = await fetch(`${SITE}/admin`, { redirect: "manual" });
  check("未登入開 /admin 被導走", res.status >= 300 && res.status < 400, `狀態 ${res.status}`);
  res = await member.request("GET", "/admin");
  check("一般使用者開 /admin 被導回首頁", res.status >= 300 && res.status < 400, `狀態 ${res.status}`);
  const blocked = [
    ["PATCH", "/api/admin/settings", { daily_quota_per_user: 99 }],
    ["GET", "/api/admin/users?email=inkquest"],
    ["PATCH", `/api/admin/users/${member.user.id}`, { daily_quota_override: 99 }],
    ["GET", "/api/admin/export?all=1"],
  ];
  for (const [method, path, body] of blocked) {
    const r = await member.request(method, path, body);
    const text = await r.text();
    check(`一般使用者呼叫 ${method} ${path.split("?")[0]} 被拒絕（403）`, r.status === 403 && !text.includes(SECRET_TEXT), `狀態 ${r.status}`);
  }
  res = await fetch(`${SITE}/api/admin/export`, { redirect: "manual" });
  check("未登入呼叫後台 API 被拒絕（401）", res.status === 401, `狀態 ${res.status}`);
  const { data: memberProfile } = await admin.from("profiles").select("daily_quota_override").eq("id", member.user.id).single();
  check("被拒絕的請求沒有改到任何資料", memberProfile.daily_quota_override === null);

  // 繞過網站，直接拿瀏覽器拿得到的 publishable key 呼叫資料庫
  const visitor = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const since = { p_since: new Date(0).toISOString() };
  let direct = await visitor.rpc("admin_usage", since);
  check("未登入的訪客直接呼叫 admin_usage 被拒絕", direct.error !== null && direct.data === null, JSON.stringify(direct.data));
  direct = await member.client.rpc("admin_usage", since);
  check("一般登入使用者直接呼叫 admin_usage 被拒絕", direct.error !== null && direct.data === null, JSON.stringify(direct.data));
  direct = await member.client.rpc("get_quota_status", { p_user_id: other.user.id });
  check("一般登入使用者不能直接查別人的額度", direct.error !== null && direct.data === null);
  direct = await member.client.from("usage_log").select("*");
  check("一般登入使用者讀不到用量紀錄", direct.error !== null || (direct.data ?? []).length === 0, `讀到 ${(direct.data ?? []).length} 筆`);
  direct = await visitor.from("usage_log").select("*");
  check("未登入的訪客讀不到用量紀錄", direct.error !== null || (direct.data ?? []).length === 0, `讀到 ${(direct.data ?? []).length} 筆`);
  direct = await member.client.from("settings").update({ value: 99 }).eq("key", "daily_quota_per_user").select();
  check("一般登入使用者不能直接改 settings", direct.error !== null || (direct.data ?? []).length === 0);

  console.log("用量總覽");
  await insertDone(member.user.id);
  await insertDone(other.user.id);
  res = await boss.request("GET", "/admin");
  let html = await res.text();
  const need = ["管理者後台", "用量總覽", "今日", "本月", "投稿數", "token 用量", "估算費用", "本月費用", "陪審員", "法官", "修改建議", "額度設定", "註冊帳號", "匯出投稿統計"];
  const missing = need.filter((t) => !html.includes(t));
  check("管理者看得到用量、費用、額度設定與匯出", res.status === 200 && missing.length === 0, `狀態 ${res.status}，缺少：${missing.join("、")}`);
  check("後台頁面不含文章內容與標題", !html.includes(SECRET_TEXT) && !html.includes(SECRET_TITLE));
  check("註冊帳號列表列出測試使用者的帳號與研究同意狀態", html.includes("註冊帳號") && html.includes(member.email) && html.includes(other.email) && html.includes("已同意"));
  const { data: usage } = await admin.rpc("admin_usage", { p_since: new Date(Date.now() - 60_000).toISOString() });
  check("用量統計算得到剛寫入的投稿與陪審員紀錄", (usage?.submissions?.done ?? 0) >= 2 && usage.tokens.some((t) => t.source === "juror" && t.calls >= 4), JSON.stringify(usage));

  console.log("用量紀錄（只能新增，刪除投稿後保留）");
  const doomed = await insertDone(member.user.id);
  const verdictInsert = await admin.from("verdicts").insert({ submission_id: doomed, output: {}, model: "mock", input_tokens: 0, output_tokens: 0 });
  check("寫入判決成功（用量紀錄的觸發器不會擋住正常寫入）", verdictInsert.error === null, verdictInsert.error?.message);
  const adviceInsert = await admin.from("advice").insert({ submission_id: doomed, output: {}, model: "mock", input_tokens: 0, output_tokens: 0 });
  check("寫入修改建議成功", adviceInsert.error === null, adviceInsert.error?.message);
  let log = await admin.from("usage_log").select("id, source, juror_code, model").eq("submission_id", doomed);
  check(
    "寫入陪審員結果、判決、修改建議時自動記錄用量",
    (log.data ?? []).length === 4 &&
      log.data.filter((r) => r.source === "juror" && r.juror_code).length === 2 &&
      log.data.some((r) => r.source === "judge" && r.juror_code === null) &&
      log.data.some((r) => r.source === "advice" && r.juror_code === null),
    JSON.stringify(log.data),
  );
  check("用量紀錄不含文章內容、標題、email 與 user id", !JSON.stringify(log.data).match(/晾衣竿|秘密標題|@example\.com/) && !JSON.stringify(log.data).includes(member.user.id));
  await admin.from("juror_results").update({ input_tokens: 0, output_tokens: 0 }).eq("submission_id", doomed).eq("juror_code", "J01");
  log = await admin.from("usage_log").select("id").eq("submission_id", doomed);
  check("結果重寫（背景工作重跑）時再記一筆", (log.data ?? []).length === 5, `共 ${(log.data ?? []).length} 筆`);
  const removed = await member.client.from("submissions").delete().eq("id", doomed);
  log = await admin.from("usage_log").select("id").eq("submission_id", doomed);
  check("使用者刪除投稿後，用量紀錄仍然保留", !removed.error && (log.data ?? []).length === 5, `共 ${(log.data ?? []).length} 筆`);
  const firstId = log.data?.[0]?.id;
  const upd = await admin.from("usage_log").update({ input_tokens: 0 }).eq("id", firstId).select();
  check("連伺服器也不能修改用量紀錄", upd.error !== null);
  const del = await admin.from("usage_log").delete().eq("id", firstId).select();
  check("連伺服器也不能刪除用量紀錄", del.error !== null);
  const ins = await admin.from("usage_log").insert({ submission_id: doomed, source: "juror", model: "fake", input_tokens: 1, output_tokens: 1 }).select();
  check("程式不能自己寫入用量紀錄（只能經由結果表自動記錄）", ins.error !== null);
  log = await admin.from("usage_log").select("id").eq("submission_id", doomed);
  check("以上操作之後紀錄數不變", (log.data ?? []).length === 5, `共 ${(log.data ?? []).length} 筆`);

  console.log("額度調整");
  res = await boss.request("PATCH", "/api/admin/settings", { daily_quota_per_user: -1 });
  check("不合格的數字被拒絕", res.status === 400);
  res = await boss.request("PATCH", "/api/admin/settings", { daily_quota_per_user: 1, global_daily_limit: 500 });
  check("管理者修改全站額度", res.status === 200, `狀態 ${res.status}`);
  let quota = (await admin.rpc("get_quota_status", { p_user_id: member.user.id })).data;
  check("修改後立即生效：一般使用者的每日上限變成 1", quota.limit === 1 && quota.global_limit === 500, JSON.stringify(quota));
  const content = "外婆家的後陽台有一支竹子做的晾衣竿。\n" + "字".repeat(300);
  // 只有在額度確定已經生效時才送出：萬一沒擋住，就會真的建立投稿、觸發背景工作
  if (quota.limit === 1) {
    res = await member.request("POST", "/api/submissions", { genre: "散文", title: "", content, modules: ["verdict"] });
    check("已用 1 次的使用者再投稿被拒絕，並說明明天重置", res.status === 429 && (await res.json()).message.includes("今日次數已用完"), `狀態 ${res.status}`);
  }

  res = await boss.request("GET", `/api/admin/users?email=${encodeURIComponent(member.email)}`);
  const found = await res.json();
  check("以 email 搜尋到使用者，並看到今日用量", res.status === 200 && found.users?.length === 1 && found.users[0].used_today === 1, JSON.stringify(found));
  res = await boss.request("GET", "/api/admin/users?email=%25");
  check("搜尋 % 不會列出所有人", res.status === 200 && (await res.json()).users.length === 0);
  res = await boss.request("PATCH", `/api/admin/users/${member.user.id}`, { daily_quota_override: 4 });
  quota = (await admin.rpc("get_quota_status", { p_user_id: member.user.id })).data;
  check("設定個別額度後立即生效（上限 4）", res.status === 200 && quota.limit === 4, JSON.stringify(quota));
  res = await boss.request("PATCH", `/api/admin/users/${member.user.id}`, { daily_quota_override: null });
  quota = (await admin.rpc("get_quota_status", { p_user_id: member.user.id })).data;
  check("改回預設後跟著全站設定（上限 1）", res.status === 200 && quota.limit === 1, JSON.stringify(quota));
  res = await boss.request("PATCH", "/api/admin/users/00000000-0000-4000-8000-000000000000", { daily_quota_override: 2 });
  check("不存在的使用者回傳找不到", res.status === 404);

  console.log("月費用警戒線");
  const budgetSet = await admin.from("settings").upsert({ key: "monthly_budget_usd", value: 0 }, { onConflict: "key" });
  if (budgetSet.error) throw new Error("無法暫時把預算設為 0，略過暫停測試（不送出投稿）");
  await admin.from("profiles").update({ daily_quota_override: 10 }).eq("id", other.user.id);
  res = await other.request("POST", "/api/submissions", { genre: "散文", title: "", content, modules: ["verdict"] });
  const pausedBody = await res.json();
  check("達到月預算時，投稿被暫停並說明何時恢復", res.status === 503 && pausedBody.message.includes("下個月 1 日恢復"), `狀態 ${res.status} ${JSON.stringify(pausedBody)}`);
  const { count: created } = await admin.from("submissions").select("id", { count: "exact", head: true }).eq("user_id", other.user.id);
  check("暫停時沒有建立投稿（不會呼叫 AI）", created === 1, `共 ${created} 筆`);
  html = await (await other.request("GET", "/submit")).text();
  check("投稿頁也顯示暫停說明", html.includes("下個月 1 日恢復"));
  html = await (await boss.request("GET", "/admin")).text();
  check("後台顯示已暫停的警示", html.includes("已自動暫停收件"));

  console.log("匯出 CSV");
  res = await boss.request("GET", "/api/admin/export");
  let csv = await res.text();
  const code = (id) => createHmac("sha256", env.RESEARCH_EXPORT_SALT).update(id).digest("hex").slice(0, 10);
  const memberCode = code(member.user.id);
  const otherCode = code(other.user.id);
  check("下載 CSV（附檔名）", res.status === 200 && (res.headers.get("content-disposition") ?? "").includes(".csv") && (res.headers.get("content-type") ?? "").includes("text/csv"));
  check("預設只含同意研究的使用者", csv.includes(`U${memberCode}`) && !csv.includes(`U${otherCode}`));
  check("不含文章內容、標題、email 與原本的 user id", !csv.includes(SECRET_TEXT) && !csv.includes(SECRET_TITLE) && !csv.includes("@example.com") && !csv.includes(member.user.id));
  const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
  const header = lines[0].split(",");
  const mine = lines.find((l) => l.startsWith(`U${memberCode},`))?.split(",") ?? [];
  check("陪審員分數放在對的欄位", mine[header.indexOf("J01")] === "7" && mine[header.indexOf("J02")] === "6" && mine[header.indexOf("J03")] === "", mine.join(","));
  res = await boss.request("GET", "/api/admin/export?all=1");
  csv = await res.text();
  check("勾選全部時也包含未同意的使用者，並標示 research_consent", csv.includes(`U${otherCode}`) && csv.includes("false"));
} catch (error) {
  failures += 1;
  console.error(`測試中斷：${error.message}`);
} finally {
  // 把設定改回原值；原本沒有的項目刪掉
  if (original) {
    const had = new Set(original.map((r) => r.key));
    if (original.length > 0) await admin.from("settings").upsert(original, { onConflict: "key" });
    const absent = KEYS.filter((k) => !had.has(k));
    if (absent.length > 0) await admin.from("settings").delete().in("key", absent);
    console.log("已把 settings 改回原值");
  }
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  if (users.length > 0) console.log("已刪除測試帳號與它們的資料");
}

console.log(failures === 0 ? "\n全部通過" : `\n有 ${failures} 項沒通過`);
process.exit(failures === 0 ? 0 : 1);
