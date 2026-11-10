"use client";
// 開庭的即時進度（PRD C-3）：背景工作把進度寫進資料庫，這裡透過 Supabase Realtime 接收。
// 另外固定每 2 秒向資料庫查一次當作保險：即使 Realtime 沒有送來事件，畫面仍會更新。
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { copy } from "@/lib/copy";
import { personas } from "@/lib/core/shared";
import { createClient } from "@/lib/supabase/client";

interface Progress {
  status: string;
  error: string | null;
  jury: string[];
  results: { juror_code: string; status: string }[];
}

const FINAL = ["done", "failed"];
const POLL_MS = 2000;
const nameOf = Object.fromEntries(personas.map((p) => [p.code, p.name]));

export function CourtProgress({ id, initial }: { id: string; initial: Progress }) {
  const t = copy.court;
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const finished = FINAL.includes(progress.status);
  const wasFinished = useRef(FINAL.includes(initial.status));

  const refetch = useCallback(async () => {
    const supabase = createClient();
    const [submission, results] = await Promise.all([
      supabase.from("submissions").select("status, error, jury").eq("id", id).maybeSingle(),
      supabase.from("juror_results").select("juror_code, status").eq("submission_id", id),
    ]);
    if (submission.error || results.error || !submission.data) return;
    setProgress({
      status: submission.data.status,
      error: submission.data.error,
      jury: submission.data.jury ?? [],
      results: results.data ?? [],
    });
  }, [id]);

  // 即時訂閱：投稿狀態與每位陪審員的結果
  useEffect(() => {
    if (finished) return;
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      // 先讓 Realtime 帶上使用者的登入身分再訂閱；
      // 否則連線會以未登入的身分建立，RLS 會把所有事件擋掉，畫面就不會動
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase
        .channel(`court-${id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "submissions", filter: `id=eq.${id}` }, refetch)
        .on("postgres_changes", { event: "*", schema: "public", table: "juror_results", filter: `submission_id=eq.${id}` }, refetch)
        .subscribe((state) => {
          // 訂閱成功的當下補查一次，避免漏掉連線前發生的變化
          if (state === "SUBSCRIBED") void refetch();
        });
    })();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [id, finished, refetch]);

  // 保險：開庭期間固定每 2 秒查一次（PRD C-3：至少每 2 秒更新）
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => void refetch(), POLL_MS);
    return () => clearInterval(timer);
  }, [finished, refetch]);

  // 結束時請伺服器重新產生頁面，帶出判決
  useEffect(() => {
    if (finished && !wasFinished.current) {
      wasFinished.current = true;
      router.refresh();
    }
  }, [finished, router]);

  const statusOf = Object.fromEntries(progress.results.map((r) => [r.juror_code, r.status]));
  const doneCount = progress.results.length;

  return (
    <section className="space-y-4" aria-live="polite">
      <p className="font-medium">
        {t.status[progress.status] ?? progress.status}
        {progress.jury.length > 0 && !finished && (
          <span className="ml-2 font-normal text-stone-600">{t.jurorsDone(doneCount, progress.jury.length)}</span>
        )}
      </p>
      {progress.status === "failed" && (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {t.failure[progress.error ?? ""] ?? t.failure.internal}
        </p>
      )}
      {progress.jury.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {progress.jury.map((code) => {
            const state = statusOf[code];
            const label = state === "ok" ? t.jurorOk : state === "failed" ? t.jurorFailed : t.jurorWaiting;
            return (
              <li
                key={code}
                className={`rounded border p-2 text-sm ${state === "ok" ? "border-stone-800" : state === "failed" ? "border-stone-200 text-stone-400" : "border-dashed border-stone-300 text-stone-500"}`}
              >
                <span className="block font-medium">{nameOf[code] ?? code}</span>
                <span className="text-xs">{label}</span>
              </li>
            );
          })}
        </ul>
      )}
      {!finished && <p className="text-sm text-stone-600">{t.canLeave}</p>}
    </section>
  );
}
