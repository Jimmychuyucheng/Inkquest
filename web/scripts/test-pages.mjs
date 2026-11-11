// 頁面測試：以測試帳號登入，經由網站的 API 投稿，等開庭完成後檢查各頁面的內容。
// 走的是和瀏覽器一樣的路徑（登入 cookie → /api/submissions → 背景工作 → /result、/history）。
// 假資料模式，不呼叫 AI、不花錢。會建立並刪除一個測試帳號。
//
// 執行前請先啟動：LLM_PROVIDER=mock 的網站（npm run dev）與 Inngest 開發伺服器。
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.mjs";

const env = loadEnv(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]);
const SITE = env.TEST_SITE_URL ?? "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failures += 1;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const has = (html, ...texts) => texts.filter((text) => !html.includes(text));

let user;
try {
  const email = `inkquest-pages-${Date.now()}@example.com`;
  const password = `P-${crypto.randomUUID()}`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw new Error(`建立測試帳號失敗：${made.error.message}`);
  user = made.data.user;
  await admin.from("profiles").update({ daily_quota_override: 10 }).eq("id", user.id);

  // 用和網站相同的方式登入，取得瀏覽器會帶的登入 cookie
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
  const get = (path) => fetch(SITE + path, { headers: { cookie: cookie() }, redirect: "manual" });
  const post = (path, body) =>
    fetch(SITE + path, { method: "POST", headers: { cookie: cookie(), "Content-Type": "application/json" }, body: JSON.stringify(body) });

  console.log("首頁");
  const home = await (await fetch(SITE + "/")).text();
  check("首頁有全員圖與選角畫面（20 位角色）", home.includes("/jurors/all.png") && home.includes("選擇角色") && (home.match(/\/jurors\/J\d{2}\.png/g) ?? []).length >= 20);

  console.log("登入與條款");
  let res = await get("/submit");
  check("還沒同意條款時，投稿頁導向條款頁", res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").includes("/terms"), `狀態 ${res.status}`);
  await client.rpc("accept_terms", { p_research_consent: false });
  res = await get("/submit");
  let html = await res.text();
  check("投稿頁顯示四個文類、四個模組與剩餘次數", res.status === 200 && has(html, "散文", "新詩", "小品文", "極短篇", "法官總評與少數意見", "具體修改建議", "今日剩餘").length === 0, has(html, "散文", "新詩", "小品文", "極短篇", "法官總評與少數意見", "具體修改建議", "今日剩餘").join("、"));
  check("未登入時投稿頁導回首頁", (await fetch(SITE + "/submit", { redirect: "manual" })).status >= 300);

  console.log("投稿（只勾法官總評）");
  const content = ["外婆家的後陽台有一支竹子做的晾衣竿。", "每年夏天，她都要我幫忙把棉被抬上去曬。", "那支竿子後來斷了，沒有人再提起。", "字".repeat(300)].join("\n");
  res = await post("/api/submissions", { genre: "散文", title: "頁面測試", content: "太短", modules: ["verdict"] });
  check("字數不足被伺服器擋下並說明", res.status === 400 && (await res.json()).message.includes("至少需要 300 字"));
  res = await post("/api/submissions", { genre: "散文", title: "頁面測試", content, modules: ["verdict"] });
  const created = await res.json();
  check("投稿成功", res.status === 201 && typeof created.id === "string", JSON.stringify(created));
  const id = created.id;

  html = await (await get(`/result/${id}`)).text();
  check("開庭中頁面顯示進度與可離開的說明", has(html, "你可以先離開這個頁面").length === 0);
  res = await post("/api/submissions", { genre: "散文", title: "第二篇", content, modules: ["verdict"] });
  check("處理中不能再投第二篇", res.status === 409 && (await res.json()).message.includes("正在開庭中"));

  const waitFor = async (status) => {
    for (let i = 0; i < 300; i += 1) {
      const { data } = await admin.from("submissions").select("status").eq("id", id).single();
      if (data.status === status || data.status === "failed") return data.status;
      await sleep(300);
    }
    return "timeout";
  };
  check("開庭完成", (await waitFor("done")) === "done");

  console.log("結果頁");
  html = await (await get(`/result/${id}`)).text();
  let missing = has(html, "頁面測試", "法官總評", "少數意見書", "最大分歧", "查看所有職業意見", "也想看", "複製法官總評", "再投一篇", "本回饋由 AI 模擬不同讀者產生");
  check("只勾法官總評：顯示判決、少數意見、補勾按鈕、複製與免責聲明", missing.length === 0, `缺少：${missing.join("、")}`);
  check("沒勾的模組不顯示（分數、修改建議）", !html.includes("分數分布") && !html.includes("修改方向"));
  missing = has(html, "法官轉述", "看判決書全文", "/jurors/");
  check("法官總評以看板呈現：角色圖、法官轉述，全文收在「看判決書全文」", missing.length === 0, `缺少：${missing.join("、")}`);
  const panels = html.match(/id="anchor-mention-J\d{2}"/g) ?? [];
  check("看板列出法官點名的陪審員（假資料點名 3 組各 1 位）", panels.length === 3, `找到 ${panels.length} 格`);
  check("別人看不到這篇（未登入導回首頁）", (await fetch(`${SITE}/result/${id}`, { redirect: "manual" })).status >= 300);

  console.log("補勾模組");
  res = await post(`/api/submissions/${id}/modules`, { module: "scores" });
  check("補勾分數：立即可看，不需生成", res.status === 200 && (await res.json()).generating === false);
  res = await post(`/api/submissions/${id}/modules`, { module: "jurors" });
  check("補勾陪審員評語", res.status === 200);
  html = await (await get(`/result/${id}`)).text();
  missing = has(html, "分數分布", "各組平均", "爭議程度", "最常被提到的面向", "收起所有職業意見");
  check("結果頁出現分數區塊，陪審員卡片預設展開", missing.length === 0, `缺少：${missing.join("、")}`);
  const cards = (html.match(/id="juror-J\d{2}"/g) ?? []).length;
  check("顯示 10 張陪審員卡片", cards === 10, `找到 ${cards} 張`);

  const before = await admin.rpc("get_quota_status", { p_user_id: user.id });
  res = await post(`/api/submissions/${id}/modules`, { module: "advice" });
  const adviceBody = await res.json();
  check("補勾修改建議：交給背景工作生成", res.status === 200 && adviceBody.generating === true, JSON.stringify(adviceBody));
  res = await post(`/api/submissions/${id}/modules`, { module: "advice" });
  check("生成中再按一次不會重複生成", res.status === 409 || (await res.json()).generating === false);
  check("修改建議生成完成，狀態回到已完成", (await waitFor("done")) === "done");
  const adviceRows = await admin.from("advice").select("submission_id").eq("submission_id", id);
  check("只有一筆修改建議", (adviceRows.data ?? []).length === 1);
  const after = await admin.rpc("get_quota_status", { p_user_id: user.id });
  check("補勾不扣次數", before.data.used === after.data.used, `${before.data.used} → ${after.data.used}`);
  html = await (await get(`/result/${id}`)).text();
  missing = has(html, "具體修改建議", "修改方向", "示範（AI 的改寫示意，不是你的原文）");
  check("結果頁出現修改建議，示範句有標明不是原文", missing.length === 0, `缺少：${missing.join("、")}`);
  check("全部補完後不再顯示「也想看」", !html.includes("也想看"));
  res = await post(`/api/submissions/${id}/modules`, { module: "hack" });
  check("不存在的模組被拒絕", res.status === 400);

  console.log("歷史紀錄與刪除");
  html = await (await get("/history")).text();
  check("歷史紀錄列出這篇，含文類、平均分與刪除按鈕", has(html, "頁面測試", "散文", "平均分", "全部刪除", "已完成").length === 0, has(html, "頁面測試", "散文", "平均分", "全部刪除", "已完成").join("、"));
  check("歷史紀錄不含文章內容", !html.includes("晾衣竿"));
  // 刪除在瀏覽器裡是以使用者身分直接向資料庫刪除；這裡用同一個身分做一次
  const del = await client.from("submissions").delete().eq("user_id", user.id);
  const left = await admin.from("juror_results").select("id").eq("submission_id", id);
  const leftVerdict = await admin.from("verdicts").select("submission_id").eq("submission_id", id);
  check("全部刪除後，陪審員結果與判決也一併從資料庫移除", !del.error && (left.data ?? []).length === 0 && (leftVerdict.data ?? []).length === 0);
  html = await (await get("/history")).text();
  check("歷史紀錄變成空的", html.includes("還沒有投稿紀錄"));
  html = await (await get(`/result/${id}`)).text();
  check("已刪除的結果頁顯示找不到", html.includes("找不到這篇投稿"));
} catch (error) {
  failures += 1;
  console.error(`測試中斷：${error.message}`);
} finally {
  if (user) await admin.auth.admin.deleteUser(user.id);
  console.log(user ? "已刪除測試帳號與它的資料" : "");
}

console.log(failures === 0 ? "\n全部通過" : `\n有 ${failures} 項沒通過`);
process.exit(failures === 0 ? 0 : 1);
