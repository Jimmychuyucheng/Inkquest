// 開庭流程 × 真實資料庫：確認每個階段寫進 Supabase 的資料正確。
// 模型用假資料（MockProvider），不呼叫 AI、不花錢。會建立並刪除一個測試帳號。
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { personas, settings } from "@/lib/core/shared";
import { MockProvider } from "@/lib/llm/mock";
import { runCourt, runJurorPhase, startCourt, type CourtDeps } from "./pipeline";
import { createSupabaseStore } from "./store";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
const store = createSupabaseStore(admin);
const CONTENT = ["外婆家的後陽台有一支竹子做的晾衣竿。", "每年夏天，她都要我幫忙把棉被抬上去曬。", "字".repeat(300)].join("\n");
let userId = "";

async function createSubmission(modules: string[]): Promise<string> {
  // 把先前的測試投稿標為失敗並調早時間，避免被額度、處理中或頻率限制擋住
  await admin
    .from("submissions")
    .update({ status: "failed", created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })
    .eq("user_id", userId);
  const { data, error } = await admin.rpc("create_submission", {
    p_user_id: userId, p_genre: "散文", p_title: "整合測試", p_content: CONTENT, p_char_count: 336, p_modules: modules,
  });
  if (error || !data?.ok) throw new Error(`建立投稿失敗：${JSON.stringify(data ?? error?.code)}`);
  return data.id as string;
}

const deps = (provider: MockProvider): CourtDeps => ({ store, provider, settings, personas });

beforeAll(async () => {
  const email = `inkquest-store-${Date.now()}@example.com`;
  const made = await admin.auth.admin.createUser({ email, password: `S-${crypto.randomUUID()}`, email_confirm: true });
  if (made.error) throw new Error(`建立測試帳號失敗：${made.error.message}`);
  userId = made.data.user.id;
  await admin.from("profiles").update({ terms_accepted_at: new Date().toISOString() }).eq("id", userId);
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("開庭結果寫入資料庫", () => {
  it("完整流程：10 位陪審員、判決、修改建議、狀態與統計", async () => {
    const id = await createSubmission(["verdict", "advice"]);
    const provider = new MockProvider();
    const result = await runCourt(id, deps(provider));
    expect(result).toEqual({ proceed: true, note: "完成" });
    expect(provider.requests).toHaveLength(12);

    const { data: row } = await admin.from("submissions").select("*").eq("id", id).single();
    expect(row).toMatchObject({ status: "done", jurors_ok: 10, error: null });
    expect(row.jury).toHaveLength(10);
    expect(row.stats).toMatchObject({ juror_count: 10 });
    expect(row.finished_at).toBeTruthy();

    const jurors = await store.getJurorResults(id);
    expect(jurors).toHaveLength(10);
    expect(jurors.map((j) => j.jurorCode)).toEqual(row.jury);
    expect(jurors[0]).toMatchObject({ status: "ok", model: "mock", attempts: 1, attemptErrors: [], personaVersion: personas[0].version });
    expect(jurors[0].output?.comment).toContain("假資料");

    expect((await store.getVerdict(id))?.headline).toBeTruthy();
    expect(await store.hasAdvice(id)).toBe(true);
    const { data: verdict } = await admin.from("verdicts").select("attempts, attempt_errors").eq("submission_id", id).single();
    expect(verdict).toEqual({ attempts: 1, attempt_errors: [] });
    const { data: advice } = await admin.from("advice").select("output, model, attempts").eq("submission_id", id).single();
    expect(advice?.attempts).toBe(1);
    expect(advice?.output.suggestions.length).toBeGreaterThanOrEqual(3);
  });

  it("3 位陪審員失敗：狀態 failed、原因代碼寫入、失敗原因保留、不佔額度", async () => {
    const id = await createSubmission(["verdict"]);
    await startCourt(id, deps(new MockProvider()));
    const jury = (await store.getSubmission(id))!.jury;
    const provider = new MockProvider({ failJurors: jury.slice(0, 3) });
    const result = await runCourt(id, deps(provider));
    expect(result.proceed).toBe(false);

    const { data: row } = await admin.from("submissions").select("status, error, jurors_ok").eq("id", id).single();
    expect(row).toEqual({ status: "failed", error: "jurors_failed", jurors_ok: 7 });
    const failed = (await store.getJurorResults(id)).filter((j) => j.status === "failed");
    expect(failed).toHaveLength(3);
    expect(failed[0].attemptErrors[0]).toContain("指定這位陪審員失敗");
    expect(await store.getVerdict(id)).toBeNull();
    const { data: quota } = await admin.rpc("get_quota_status", { p_user_id: userId });
    expect(quota).toMatchObject({ used: 0, in_progress: false });
  });

  it("陪審員階段重跑不會產生重複資料，也不會重新呼叫已完成的陪審員", async () => {
    const id = await createSubmission(["verdict"]);
    const provider = new MockProvider();
    await startCourt(id, deps(provider));
    await runJurorPhase(id, deps(provider));
    await runJurorPhase(id, deps(provider));
    expect(provider.requests).toHaveLength(10);
    expect(await store.getJurorResults(id)).toHaveLength(10);
    // 同一位陪審員重複寫入時覆蓋，不會多一筆
    const [first] = await store.getJurorResults(id);
    await store.saveJurorResult(id, { ...first, attempts: 2 });
    const again = await store.getJurorResults(id);
    expect(again).toHaveLength(10);
    expect(again[0].attempts).toBe(2);
  });

  it("投稿不存在時安靜地停止", async () => {
    const result = await runCourt("00000000-0000-4000-8000-000000000000", deps(new MockProvider()));
    expect(result.proceed).toBe(false);
  });
});
