// 投稿 API（PRD 第 9 節）：只負責驗證與排隊。
// 額度、字數、登入身分全部在這裡（伺服器端）檢查，不依賴前端。
// 陪審員與法官在背景工作中執行（src/inngest/functions.ts）。
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { rejectMessage, validateSubmission } from "@/lib/core/quota";
import { settings } from "@/lib/core/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { COURT_EVENT, inngest } from "@/inngest/client";

const REJECT_STATUS: Record<string, number> = {
  terms_required: 403,
  in_progress: 409,
  quota_exceeded: 429,
  global_full: 429,
  rate_limited: 429,
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

  // 3. 額度檢查與建立投稿：在資料庫的同一個交易內完成
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

  // 4. 交給背景工作佇列；陪審員與法官在背景執行，這個請求立刻回應
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
