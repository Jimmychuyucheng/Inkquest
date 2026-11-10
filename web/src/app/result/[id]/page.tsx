// /result/[id]（PRD 第 7 節）：處理中顯示「開庭中」，完成後顯示結果頁。
import Link from "next/link";
import { CourtProgress } from "@/components/court-progress";
import { ResultView } from "@/components/result-view";
import { buttonVariants } from "@/components/ui/button";
import { requireTermsAccepted } from "@/lib/auth";
import { copy } from "@/lib/copy";
import type { AdviceOutput, JudgeOutput, JurorOutput } from "@/lib/core/schemas";
import type { SessionStats } from "@/lib/core/stats";
import { createClient } from "@/lib/supabase/server";

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  await requireTermsAccepted();
  const { id } = await params;
  const t = copy.court;
  const supabase = await createClient();
  // 以使用者自己的身分查詢：RLS 保證只讀得到自己的投稿
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const { data: submission } = isUuid
    ? await supabase.from("submissions").select("id, title, status, jury, error, modules, stats").eq("id", id).maybeSingle()
    : { data: null };

  if (!submission) {
    return (
      <div className="space-y-4">
        <p role="alert">{t.notFound}</p>
        <Link href="/submit" className={buttonVariants()}>{t.again}</Link>
      </div>
    );
  }

  const [{ data: results }, { data: verdictRow }, { data: adviceRow }] = await Promise.all([
    supabase.from("juror_results").select("juror_code, status, output").eq("submission_id", id).order("juror_code"),
    supabase.from("verdicts").select("output").eq("submission_id", id).maybeSingle(),
    supabase.from("advice").select("output").eq("submission_id", id).maybeSingle(),
  ]);
  const verdict = (verdictRow?.output as JudgeOutput | undefined) ?? null;
  const jurors = (results ?? []) as { juror_code: string; status: string; output: JurorOutput | null }[];

  if (submission.status === "failed") {
    return (
      <div className="max-w-2xl space-y-5">
        <h1 className="font-heading text-2xl font-semibold">{submission.title || copy.result.untitled}</h1>
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 leading-relaxed text-amber-900">
          {t.failure[submission.error ?? ""] ?? t.failure.internal}
        </p>
        <Link href="/submit" className={buttonVariants()}>{t.again}</Link>
      </div>
    );
  }

  // 判決一出來就顯示結果頁；修改建議還在生成時，結果頁會自己等它
  if (verdict && (submission.status === "done" || submission.status === "advice_running")) {
    return (
      <ResultView
        data={{
          id: submission.id,
          title: submission.title,
          status: submission.status,
          modules: submission.modules,
          jury: submission.jury ?? [],
          stats: (submission.stats as SessionStats | null) ?? null,
          jurors,
          verdict,
          advice: (adviceRow?.output as AdviceOutput | undefined) ?? null,
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">{submission.title || copy.result.untitled}</h1>
      <CourtProgress
        id={submission.id}
        initial={{
          status: submission.status,
          error: submission.error,
          jury: submission.jury ?? [],
          results: jurors.map(({ juror_code, status }) => ({ juror_code, status })),
        }}
      />
    </div>
  );
}
