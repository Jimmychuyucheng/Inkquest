// 結果頁補勾模組（PRD D-4）。不扣次數。
// 「陪審員評語」「分數」的資料本來就有，只是記下使用者想看；
// 「修改建議」沒有生成過時，交給背景工作另外生成（每篇最多一筆）。
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ADVICE_EVENT, inngest } from "@/inngest/client";
import { getCurrentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { moduleView } from "@/lib/core/result";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.strictObject({ module: z.enum(["jurors", "scores", "advice"]) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: copy.errors.notLoggedIn }, { status: 401 });
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.uuid().safeParse(id).success) {
    return NextResponse.json({ message: copy.errors.generic }, { status: 400 });
  }
  const { module } = parsed.data;

  const admin = createAdminClient();
  // 一定要同時比對 user_id：只能改自己的投稿
  const { data: submission } = await admin
    .from("submissions")
    .select("id, status, modules")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!submission) return NextResponse.json({ message: copy.court.notFound }, { status: 404 });
  if (submission.status !== "done") return NextResponse.json({ message: copy.result.addNotReady }, { status: 409 });
  if (!moduleView(submission.modules).addable.includes(module)) return NextResponse.json({ ok: true, generating: false });

  const modules = [...submission.modules, module];
  let generating = false;
  if (module === "advice") {
    const { data: existing } = await admin.from("advice").select("submission_id").eq("submission_id", id).maybeSingle();
    generating = !existing;
  }

  // 條件式更新：只有狀態仍是 done 才會成功，避免同時按兩次產生兩份
  const { data: updated, error } = await admin
    .from("submissions")
    .update(generating ? { modules, status: "advice_running" } : { modules })
    .eq("id", id)
    .eq("status", "done")
    .select("id");
  if (error || !updated || updated.length === 0) {
    return NextResponse.json({ message: copy.result.addNotReady }, { status: 409 });
  }

  if (generating) {
    try {
      await inngest.send({ name: ADVICE_EVENT, data: { submissionId: id } });
    } catch (sendError) {
      console.error("送出修改建議的背景工作失敗", sendError instanceof Error ? sendError.name : "");
      await admin.from("submissions").update({ status: "done", modules: submission.modules }).eq("id", id);
      return NextResponse.json({ message: copy.result.adviceFailed }, { status: 503 });
    }
  }
  return NextResponse.json({ ok: true, generating });
}
