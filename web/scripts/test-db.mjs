// 用真實的 Supabase 專案測試額度與資料權限（npm run test:db）。
// 不會呼叫任何 AI 模型。會建立兩個測試帳號，測完後連同它們的資料一起刪除。
//
// 檢查項目（對應 PRD 驗收清單）：
// 1. 沒同意條款不能投稿
// 2. 每日 3 次，第 4 次被伺服器拒絕；失敗的投稿不扣次數
// 3. 同時只能有一筆處理中的投稿
// 4. 同時送出多次也不會超額
// 5. 使用者繞過前端直接呼叫資料庫：不能建立投稿、不能改自己的額度或角色、看不到別人的資料
// 6. 刪除後資料庫查不到該文章
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.mjs";

const env = loadEnv(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

async function makeUser(label) {
  const email = `inkquest-test-${label}-${Date.now()}@example.com`;
  const password = `T-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`建立測試帳號失敗：${error.message}`);
  const client = createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`測試帳號登入失敗：${signIn.error.message}（請確認 Supabase 的 Email 登入方式沒有被關閉）`);
  return { id: data.user.id, client };
}

const create = (userId, content = "字".repeat(400)) =>
  admin.rpc("create_submission", {
    p_user_id: userId, p_genre: "散文", p_title: "測試", p_content: content, p_char_count: 400, p_modules: ["verdict"],
  });
const finish = (id, status) => admin.from("submissions").update({ status }).eq("id", id);

const users = [];
try {
  const alice = await makeUser("a");
  const bob = await makeUser("b");
  users.push(alice, bob);

  console.log("條款");
  let r = await create(alice.id);
  check("沒同意條款不能投稿", r.data?.ok === false && r.data.reason === "terms_required", JSON.stringify(r));
  const consent = await alice.client.rpc("accept_terms", { p_research_consent: true });
  check("使用者可以同意條款", !consent.error, consent.error?.message);
  const profile = await alice.client.from("profiles").select("*").single();
  check("同意時間與研究同意寫入資料庫", !!profile.data?.terms_accepted_at && profile.data.research_consent === true);
  await bob.client.rpc("accept_terms", { p_research_consent: false });

  console.log("額度");
  const ids = [];
  for (let i = 1; i <= 3; i += 1) {
    r = await create(alice.id);
    check(`第 ${i} 次投稿成功`, r.data?.ok === true, JSON.stringify(r.data ?? r.error));
    if (r.data?.ok) {
      ids.push(r.data.id);
      if (i === 1) {
        const second = await create(alice.id);
        check("前一篇還在處理中時不能再投", second.data?.reason === "in_progress", JSON.stringify(second.data));
      }
      await finish(r.data.id, "done");
    }
  }
  r = await create(alice.id);
  check("第 4 次被拒絕", r.data?.ok === false && r.data.reason === "quota_exceeded", JSON.stringify(r.data));
  let status = await admin.rpc("get_quota_status", { p_user_id: alice.id });
  check("剩餘次數為 0", status.data?.remaining === 0 && status.data.used === 3, JSON.stringify(status.data));

  await finish(ids[0], "failed");
  status = await admin.rpc("get_quota_status", { p_user_id: alice.id });
  check("失敗的投稿不扣次數", status.data?.remaining === 1, JSON.stringify(status.data));
  r = await create(alice.id);
  check("退回次數後可以再投一次", r.data?.ok === true, JSON.stringify(r.data));
  if (r.data?.ok) await finish(r.data.id, "done");

  console.log("同時送出");
  const burst = await Promise.all(Array.from({ length: 6 }, () => create(bob.id)));
  const accepted = burst.filter((x) => x.data?.ok).length;
  check("同時送出 6 次只有 1 次成立", accepted === 1, `成立 ${accepted} 次`);

  console.log("繞過前端");
  const direct = await alice.client.rpc("create_submission", {
    p_user_id: alice.id, p_genre: "散文", p_title: "", p_content: "字".repeat(400), p_char_count: 400, p_modules: ["verdict"],
  });
  check("使用者不能直接呼叫建立投稿的函式", !!direct.error);
  const insert = await alice.client.from("submissions").insert({
    user_id: alice.id, genre: "散文", content: "字".repeat(400), char_count: 400, modules: ["verdict"],
  });
  check("使用者不能直接新增投稿", !!insert.error);
  await alice.client.from("profiles").update({ role: "admin", daily_quota_override: 999 }).eq("id", alice.id);
  const after = await admin.from("profiles").select("role, daily_quota_override").eq("id", alice.id).single();
  check("使用者不能把自己改成管理者或調高額度", after.data?.role === "user" && after.data.daily_quota_override === null);
  const settings = await alice.client.from("settings").select("*");
  check("使用者讀不到 settings", (settings.data ?? []).length === 0);
  const others = await bob.client.from("submissions").select("id").in("id", ids);
  check("看不到別人的投稿", (others.data ?? []).length === 0);
  const othersProfile = await bob.client.from("profiles").select("id").eq("id", alice.id);
  check("看不到別人的 profile", (othersProfile.data ?? []).length === 0);
  const mine = await alice.client.from("submissions").select("id");
  check("看得到自己的投稿", (mine.data ?? []).length >= 3);
  await alice.client.from("submissions").update({ status: "failed" }).eq("id", ids[1]);
  const unchanged = await admin.from("submissions").select("status").eq("id", ids[1]).single();
  check("使用者不能把投稿改成失敗來退回次數", unchanged.data?.status === "done");

  console.log("刪除");
  await bob.client.from("submissions").delete().eq("id", ids[1]);
  const stillThere = await admin.from("submissions").select("id").eq("id", ids[1]);
  check("不能刪別人的投稿", (stillThere.data ?? []).length === 1);
  await alice.client.from("submissions").delete().eq("id", ids[1]);
  const gone = await admin.from("submissions").select("id").eq("id", ids[1]);
  check("刪除自己的投稿後，資料庫查不到該文章", (gone.data ?? []).length === 0);

  const personas = await alice.client.from("personas").select("code");
  console.log("人設");
  check("讀得到 20 位陪審員（需先執行 npm run seed）", (personas.data ?? []).length === 20, `目前 ${(personas.data ?? []).length} 位`);
} catch (error) {
  failures += 1;
  console.error(`測試中斷：${error.message}`);
} finally {
  for (const user of users) await admin.auth.admin.deleteUser(user.id);
  console.log(users.length > 0 ? "已刪除測試帳號與它們的資料" : "");
}

console.log(failures === 0 ? "\n全部通過" : `\n有 ${failures} 項沒通過`);
process.exit(failures === 0 ? 0 : 1);
