"use client";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { copy } from "@/lib/copy";
import { formatScore } from "@/lib/core/result";
import { createClient } from "@/lib/supabase/client";

export interface HistoryItem {
  id: string;
  title: string;
  genre: string;
  status: string;
  meanScore: number | null;
  date: string;
}

/** target：要刪的那一筆；"all" 表示全部。 */
type Target = HistoryItem | "all" | null;

export function HistoryList({ items, userId }: { items: HistoryItem[]; userId: string }) {
  const t = copy.history;
  const router = useRouter();
  const [target, setTarget] = useState<Target>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirmDelete() {
    if (!target) return;
    setBusy(true);
    setFailed(false);
    const supabase = createClient();
    // 真正從資料庫刪除（不是標記）；陪審員結果、判決、修改建議會一起刪掉。RLS 只允許刪自己的。
    const query = supabase.from("submissions").delete();
    const { error } = target === "all" ? await query.eq("user_id", userId) : await query.eq("id", target.id);
    setBusy(false);
    if (error) {
      setFailed(true);
      return;
    }
    setTarget(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-lg border bg-card">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
            <div className="min-w-0 flex-1">
              <Link href={`/result/${item.id}`} className="block truncate font-medium underline-offset-4 hover:underline">
                {item.title}
              </Link>
              <p className="text-sm text-muted-foreground">
                {item.genre}・{item.date}・{t.statusLabel[item.status] ?? item.status}
              </p>
            </div>
            <div className="text-right">
              <span className="block text-xs text-muted-foreground">{copy.result.meanScore}</span>
              <span className="font-heading text-xl font-semibold">{formatScore(item.meanScore)}</span>
            </div>
            <div className="flex gap-1">
              <Link href={`/result/${item.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>{t.view}</Link>
              <Button variant="ghost" size="sm" onClick={() => setTarget(item)} aria-label={`${t.delete}「${item.title}」`}>
                <Trash2 aria-hidden />
                {t.delete}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="destructive" onClick={() => setTarget("all")}>{t.deleteAll}</Button>

      <AlertDialog open={target !== null} onOpenChange={(open) => !open && !busy && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {target === "all" ? t.confirmDeleteAllTitle : target ? t.confirmDeleteTitle(target.title) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>{t.confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          {failed && <p role="alert" className="text-sm text-destructive">{t.deleteFailed}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={(event) => { event.preventDefault(); void confirmDelete(); }}>
              {t.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
