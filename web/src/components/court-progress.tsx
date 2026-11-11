"use client";
// 開庭中（PRD 第 7 節）：本次 10 位陪審員的圖示，完成者亮起；進度條；法官撰寫判決書的提示。
// 進度由背景工作寫進資料庫，這裡透過 Supabase Realtime 接收；
// 另外固定每 2 秒查一次當作保險，即使 Realtime 沒有送來事件，畫面仍會更新（C-3）。
import { Gavel } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PersonaIcon, groupStyle, personaByCode } from "@/components/persona-icon";
import { Progress } from "@/components/ui/progress";
import { copy } from "@/lib/copy";
import { createClient } from "@/lib/supabase/client";

export interface CourtProgressState {
  status: string;
  error: string | null;
  jury: string[];
  results: { juror_code: string; status: string }[];
}

// 這些狀態下，伺服器端的頁面已經有新內容（判決或失敗說明），要重新載入
const SETTLED = ["advice_running", "done", "failed"];
const POLL_MS = 2000;

export function CourtProgress({ id, initial }: { id: string; initial: CourtProgressState }) {
  const t = copy.court;
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const settled = SETTLED.includes(progress.status);
  const refreshed = useRef(false);

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

  useEffect(() => {
    if (settled) return;
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
          if (state === "SUBSCRIBED") void refetch();
        });
    })();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [id, settled, refetch]);

  useEffect(() => {
    if (settled) return;
    const timer = setInterval(() => void refetch(), POLL_MS);
    return () => clearInterval(timer);
  }, [settled, refetch]);

  useEffect(() => {
    if (settled && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [settled, router]);

  const statusOf = Object.fromEntries(progress.results.map((r) => [r.juror_code, r.status]));
  const total = progress.jury.length;
  const doneCount = progress.jury.filter((code) => statusOf[code]).length;
  const judging = progress.status === "judge_running";
  // 陪審員佔九成，法官佔最後一成
  const percent = total === 0 ? 3 : judging ? 95 : Math.round((doneCount / total) * 90);

  return (
    <section className="space-y-6" aria-live="polite">
      <div className="space-y-2">
        <p className="flex items-center gap-2 font-heading text-xl">
          {judging && <Gavel className="size-5 animate-pulse text-brass" aria-hidden />}
          {judging ? t.judgeWriting : (t.status[progress.status] ?? progress.status)}
        </p>
        <Progress value={percent} aria-label={t.progress} />
        {total > 0 && <p className="text-sm text-muted-foreground">{t.jurorsDone(doneCount, total)}</p>}
      </div>

      {total > 0 && (
        <div className="space-y-3 rounded-2xl border-2 border-primary/15 bg-card p-4">
        <p className="text-sm font-medium">{t.juryTitle(total)}</p>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {progress.jury.map((code) => {
            const state = statusOf[code];
            const label = state === "ok" ? t.jurorOk : state === "failed" ? t.jurorFailed : t.jurorWaiting;
            return (
              <li key={code} className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 text-center transition-colors ${state === "ok" ? `${groupStyle(code).border} ${groupStyle(code).bg}` : "border-dashed border-border bg-background"}`}>
                {/* key 帶上狀態：完成的那一刻重新掛上，播放一次「入席」動畫 */}
                <PersonaIcon key={`${code}-${state ?? "wait"}`} code={code} size="lg" dim={state !== "ok"} className={state === "ok" ? "animate-seat-in" : state ? "" : "animate-pulse"} />
                <span className={`text-sm font-medium ${state === "ok" ? "" : "text-muted-foreground"}`}>
                  {personaByCode[code]?.name ?? code}
                </span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </li>
            );
          })}
        </ul>
        </div>
      )}
      <p className="text-sm text-muted-foreground">{t.canLeave}</p>
    </section>
  );
}

/** 等待某個狀態結束（例如補勾的修改建議生成中）：每 2 秒查一次，結束後重新載入頁面。 */
export function WaitForStatus({ id, whileStatus }: { id: string; whileStatus: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const timer = setInterval(async () => {
      const { data } = await supabase.from("submissions").select("status").eq("id", id).maybeSingle();
      if (!data || data.status !== whileStatus) {
        clearInterval(timer);
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [id, whileStatus, router]);
  return null;
}
