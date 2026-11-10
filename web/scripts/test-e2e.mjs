// 端對端測試：用真實的 Supabase 與本機的 Inngest 開發伺服器，以假資料模式跑完一次開庭。
// 不呼叫 AI、不花錢。會建立並刪除一個測試帳號。
//
// 執行前請先開兩個終端機：
//   1. LLM_PROVIDER=mock npm run dev
//   2. npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
// 然後：npm run test:e2e
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.mjs";

const env = loadEnv(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]);
const INNGEST_URL = env.INNGEST_DEV_URL ?? "http://localhost:8288";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failures += 1;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function hold(userId, modules, label) {
  const content = ["外婆家的後陽台有一支竹子做的晾衣竿。", "每年夏天，她都要我幫忙把棉被抬上去曬。", "字".repeat(300)].join("\n");
  const created = await admin.rpc("create_submission", {
    p_user_id: userId, p_genre: "散文", p_title: `端對端測試 ${label}`, p_content: content, p_char_count: 340, p_modules: modules,
  });
  if (!created.data?.ok) throw new Error(`建立投稿失敗：${JSON.stringify(created.data ?? created.error?.code)}`);
  const id = created.data.id;
  const sent = await fetch(`${INNGEST_URL}/e/dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "court/submission.created", data: { submissionId: id } }),
  }).catch(() => null);
  if (!sent?.ok) throw new Error(`無法把事件送到 Inngest 開發伺服器（${INNGEST_URL}）。請確認它已經啟動。`);

  const seen = new Set();
  const started = Date.now();
  let row;
  while (Date.now() - started < 120_000) {
    row = (await admin.from("submissions").select("status, jury, jurors_ok, stats, error, finished_at").eq("id", id).single()).data;
    seen.add(row.status);
    if (row.status === "done" || row.status === "failed") break;
    await sleep(300);
  }
  return { id, row, seen, seconds: Math.round((Date.now() - started) / 100) / 10 };
}

let user;
try {
  const email = `inkquest-e2e-${Date.now()}@example.com`;
  const password = `E2e-${crypto.randomUUID()}`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw new Error(`建立測試帳號失敗：${made.error.message}`);
  user = made.data.user;
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password });
  await client.rpc("accept_terms", { p_research_consent: false });

  console.log("只勾選判決");
  let run = await hold(user.id, ["verdict"], "A");
  check(`開庭完成（${run.seconds} 秒）`, run.row?.status === "done", `狀態 ${run.row?.status}，原因 ${run.row?.error}`);
  check("抽出 10 位陪審員", run.row?.jury?.length === 10);
  check("至少 8 位陪審員完成", (run.row?.jurors_ok ?? 0) >= 8, `完成 ${run.row?.jurors_ok} 位`);
  check("統計已寫入", run.row?.stats?.juror_count === run.row?.jurors_ok && !!run.row?.finished_at);
  const jurors = await client.from("juror_results").select("juror_code, status, output, model").eq("submission_id", run.id);
  check("使用者讀得到自己的 10 筆陪審員結果", (jurors.data ?? []).length === 10, `讀到 ${(jurors.data ?? []).length} 筆`);
  check("假資料模式沒有呼叫真實模型", (jurors.data ?? []).every((r) => r.model === "mock" || r.status === "failed"), "模型不是 mock，請確認網站以 LLM_PROVIDER=mock 啟動");
  const verdict = await client.from("verdicts").select("output").eq("submission_id", run.id).maybeSingle();
  check("使用者讀得到判決", !!verdict.data?.output?.headline);
  const noAdvice = await admin.from("advice").select("submission_id").eq("submission_id", run.id);
  check("沒勾選修改建議就不產生", (noAdvice.data ?? []).length === 0);

  console.log("勾選修改建議");
  run = await hold(user.id, ["verdict", "advice"], "B");
  check(`開庭完成（${run.seconds} 秒）`, run.row?.status === "done", `狀態 ${run.row?.status}，原因 ${run.row?.error}`);
  const advice = await client.from("advice").select("output").eq("submission_id", run.id).maybeSingle();
  check("修改建議已寫入", (advice.data?.output?.suggestions ?? []).length >= 3);
} catch (error) {
  failures += 1;
  console.error(`測試中斷：${error.message}`);
} finally {
  if (user) await admin.auth.admin.deleteUser(user.id);
  console.log(user ? "已刪除測試帳號與它的資料" : "");
}

console.log(failures === 0 ? "\n全部通過" : `\n有 ${failures} 項沒通過`);
process.exit(failures === 0 ? 0 : 1);
