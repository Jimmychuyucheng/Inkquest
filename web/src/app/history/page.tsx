// 歷史紀錄（PRD D-5、D-6）：依時間新到舊，可刪除單筆或全部。
import Link from "next/link";
import { HistoryList, type HistoryItem } from "@/components/history-list";
import { buttonVariants } from "@/components/ui/button";
import { requireTermsAccepted } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { formatDateTime } from "@/lib/core/result";
import { settings } from "@/lib/core/shared";
import { createClient } from "@/lib/supabase/server";

export default async function HistoryPage() {
  const user = await requireTermsAccepted();
  const supabase = await createClient();
  // RLS 只會回傳自己的投稿；不讀取文章內容
  const { data } = await supabase
    .from("submissions")
    .select("id, title, genre, status, stats, created_at")
    .order("created_at", { ascending: false });
  const items: HistoryItem[] = (data ?? []).map((row) => ({
    id: row.id,
    title: row.title || copy.result.untitled,
    genre: row.genre,
    status: row.status,
    meanScore: (row.stats as { mean_score?: number } | null)?.mean_score ?? null,
    date: formatDateTime(row.created_at, settings.web.timezone),
  }));

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">{copy.history.title}</h1>
      {items.length === 0 ? (
        <div className="space-y-4">
          <p className="text-muted-foreground">{copy.history.empty}</p>
          <Link href="/submit" className={buttonVariants()}>{copy.home.start}</Link>
        </div>
      ) : (
        <HistoryList items={items} userId={user.id} />
      )}
    </div>
  );
}
