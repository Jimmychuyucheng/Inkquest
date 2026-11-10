// 開庭頁（W2 的基本版）：顯示即時進度；完成後顯示判決摘要。
// 完整的開庭動畫與結果頁在 W3 製作。
import Link from "next/link";
import { CourtProgress } from "@/components/court-progress";
import { requireTermsAccepted } from "@/lib/auth";
import { copy } from "@/lib/copy";
import type { AdviceOutput, JudgeOutput } from "@/lib/core/schemas";
import { createClient } from "@/lib/supabase/server";

export default async function CourtPage({ params }: { params: Promise<{ id: string }> }) {
  await requireTermsAccepted();
  const { id } = await params;
  const t = copy.court;
  const supabase = await createClient();
  // 以使用者自己的身分查詢：RLS 保證只讀得到自己的投稿
  const isUuid = /^[0-9a-f-]{36}$/i.test(id);
  const { data: submission } = isUuid
    ? await supabase.from("submissions").select("id, title, genre, status, jury, error, modules").eq("id", id).maybeSingle()
    : { data: null };

  if (!submission) {
    return (
      <div className="space-y-4">
        <p role="alert">{t.notFound}</p>
        <Link href="/submit" className="underline">{t.again}</Link>
      </div>
    );
  }

  const [{ data: results }, { data: verdictRow }, { data: adviceRow }] = await Promise.all([
    supabase.from("juror_results").select("juror_code, status").eq("submission_id", id),
    supabase.from("verdicts").select("output").eq("submission_id", id).maybeSingle(),
    supabase.from("advice").select("output").eq("submission_id", id).maybeSingle(),
  ]);
  const verdict = (verdictRow?.output as JudgeOutput | undefined) ?? null;
  const advice = (adviceRow?.output as AdviceOutput | undefined) ?? null;
  const done = submission.status === "done";

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{submission.title || "未命名"}</h1>
      <CourtProgress
        id={submission.id}
        initial={{ status: submission.status, error: submission.error, jury: submission.jury ?? [], results: results ?? [] }}
      />
      {done && verdict && (
        <section className="space-y-3 rounded border border-stone-200 p-4">
          <h2 className="text-lg font-semibold">{verdict.headline}</h2>
          <p className="whitespace-pre-wrap leading-relaxed">{verdict.verdict}</p>
          <h3 className="font-medium">少數意見書</h3>
          <p className="whitespace-pre-wrap leading-relaxed text-stone-700">{verdict.minority_opinion}</p>
        </section>
      )}
      {done && submission.modules.includes("advice") && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{copy.submit.moduleNames.advice}</h2>
          {advice ? (
            <ul className="space-y-3">
              {advice.suggestions.map((item, index) => (
                <li key={index} className="rounded border border-stone-200 p-3 text-sm leading-relaxed">
                  <blockquote className="border-l-2 border-stone-400 pl-3 text-stone-600">{item.quote}</blockquote>
                  <p className="mt-2">{item.issue}</p>
                  <p className="mt-1">{item.direction}</p>
                  {item.example && <p className="mt-1 text-stone-600">{item.example}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-600">{t.adviceMissing}</p>
          )}
        </section>
      )}
      {(done || submission.status === "failed") && (
        <Link href="/submit" className="inline-block underline">{t.again}</Link>
      )}
    </div>
  );
}
