// 投稿 API（PRD 第 9 節）：只負責驗證與排隊。
// 額度、字數、登入身分全部在這裡（伺服器端）檢查，不依賴前端。
// 陪審員與法官在背景工作中執行（src/inngest/functions.ts）。
import { NextResponse, type NextRequest } from "next/server";
import { getBudgetStatus } from "@/lib/admin-server";
import { getCurrentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { drawJury, juryMode, validatePicks } from "@/lib/core/jury";
import { rejectMessage, validateSubmission } from "@/lib/core/quota";
import { personas, settings } from "@/lib/core/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { COURT_EVENT, inngest } from "@/inngest/client";

const REJECT_STATUS: Record<string, number> = {
  terms_required: 403,
  in_progress: 409,
  quota_exceeded: 429,
  global_full: 429,
  rate_limited: 429,
  budget_paused: 503,
};

export async function POST(request: NextRequest) {
  // 1. 身分：由伺服器向 Supabase 確認，不接受請求內容自己宣稱的 user id
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: copy.errors.notLoggedIn }, { status: 401 });

  // 2. 內容：文類、字數、模組
  const body = await request.json().catch(() => null);
  const validated = validateSubmission(body, settings);
  if (!validated.ok) return NextResponse.json({ message: validated.message }, { status: 400 });
  const { genre, title, content, modules, charCount } = validated.value;
  // 自己選的陪審員（可選）：不合規則就整筆拒絕，不扣次數
  const picked = validatePicks(body?.jury, personas, settings.jury);
  if (!picked.ok) return NextResponse.json({ message: copy.submit.invalidJury }, { status: 400 });

  // 3. 月費用警戒線（PRD 第 10 節）：本月估算費用達上限就暫停收件
  try {
    const budget = await getBudgetStatus();
    if (budget.level === "paused") {
      return NextResponse.json({ message: rejectMessage("budget_paused") }, { status: REJECT_STATUS.budget_paused });
    }
  } catch {
    // 查不到費用時不放行：寧可暫停，也不要在不知道花了多少的情況下繼續呼叫模型
    return NextResponse.json({ message: copy.errors.generic }, { status: 500 });
  }

  // 4. 額度檢查與建立投稿：在資料庫的同一個交易內完成
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_submission", {
    p_user_id: user.id,
    p_genre: genre,
    p_title: title,
    p_content: content,
    p_char_count: charCount,
    p_modules: modules,
  });
  if (error || !data) {
    console.error("create_submission 失敗", error?.code);
    return NextResponse.json({ message: copy.errors.generic }, { status: 500 });
  }
  if (!data.ok) {
    return NextResponse.json(
      { message: rejectMessage(data.reason) },
      { status: REJECT_STATUS[data.reason] ?? 400 },
    );
  }

  // 5. 自己選人時：補滿名額後寫進投稿，背景工作就不會重抽
  if (picked.picks.length > 0) {
    const jury = drawJury(data.id, personas, settings.jury, picked.picks).map((p) => p.code);
    const { error: juryError } = await admin
      .from("submissions")
      .update({ jury, jury_mode: juryMode(picked.picks, settings.jury) })
      .eq("id", data.id);
    if (juryError) {
      console.error("寫入指定陪審團失敗", juryError.code);
      await admin
        .from("submissions")
        .update({ status: "failed", error: "internal", finished_at: new Date().toISOString() })
        .eq("id", data.id);
      return NextResponse.json({ message: copy.errors.generic }, { status: 500 });
    }
  }

  // 6. 交給背景工作佇列；陪審員與法官在背景執行，這個請求立刻回應
  try {
    await inngest.send({ name: COURT_EVENT, data: { submissionId: data.id } });
  } catch (sendError) {
    console.error("送出背景工作失敗", sendError instanceof Error ? sendError.name : "");
    // 標記為失敗，等於退回這一次的額度
    await admin
      .from("submissions")
      .update({ status: "failed", error: "internal", finished_at: new Date().toISOString() })
      .eq("id", data.id);
    return NextResponse.json({ message: copy.errors.enqueueFailed }, { status: 503 });
  }
  return NextResponse.json({ id: data.id }, { status: 201 });
}
