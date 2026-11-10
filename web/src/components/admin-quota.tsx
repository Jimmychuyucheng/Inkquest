"use client";
// 後台額度設定（PRD E-2）：全站預設次數、全站上限、個別使用者額度。
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/copy";

const t = copy.admin;

/** 輸入框的文字 → 0 以上的整數；不合格回傳 null。 */
function toCount(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return Number.isSafeInteger(n) ? n : null;
}

type Feedback = { kind: "ok" | "error"; text: string } | null;

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <p role={feedback.kind === "error" ? "alert" : "status"} className={`text-sm ${feedback.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}>
      {feedback.text}
    </p>
  );
}

async function send(url: string, method: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.message ?? t.saveFailed;
  } catch {
    return copy.submit.networkError;
  }
}

function GlobalSettings({ dailyQuota, globalLimit, globalUsedToday }: { dailyQuota: number; globalLimit: number; globalUsedToday: number }) {
  const router = useRouter();
  const [daily, setDaily] = useState(String(dailyQuota));
  const [global, setGlobal] = useState(String(globalLimit));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const d = toCount(daily);
    const g = toCount(global);
    if (d === null || g === null) {
      setFeedback({ kind: "error", text: t.invalidNumber });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const error = await send("/api/admin/settings", "PATCH", { daily_quota_per_user: d, global_daily_limit: g });
    setBusy(false);
    setFeedback(error ? { kind: "error", text: error } : { kind: "ok", text: t.saved });
    if (!error) router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{t.quotaIntro}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="daily-quota">{t.dailyQuota}</Label>
          <Input id="daily-quota" inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="global-limit">{t.globalLimit}</Label>
          <Input id="global-limit" inputMode="numeric" value={global} onChange={(e) => setGlobal(e.target.value)} />
          <p className="text-xs text-muted-foreground">{t.globalUsed(globalUsedToday)}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? t.saving : t.save}</Button>
        <FeedbackLine feedback={feedback} />
      </div>
    </form>
  );
}

interface AdminUser {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  daily_quota_override: number | null;
  used_today: number;
  limit_today: number;
}

function UserRow({ user, onChanged }: { user: AdminUser; onChanged: () => void }) {
  const [value, setValue] = useState(user.daily_quota_override === null ? "" : String(user.daily_quota_override));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function update(override: number | null) {
    setBusy(true);
    setFeedback(null);
    const error = await send(`/api/admin/users/${user.id}`, "PATCH", { daily_quota_override: override });
    setBusy(false);
    if (error) {
      setFeedback({ kind: "error", text: error });
      return;
    }
    setFeedback({ kind: "ok", text: t.saved });
    onChanged();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const n = toCount(value);
    if (n === null) {
      setFeedback({ kind: "error", text: t.invalidNumber });
      return;
    }
    void update(n);
  }

  return (
    <li className="space-y-2 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium break-all">{user.email}</span>
        {user.display_name && <span className="text-sm text-muted-foreground">{user.display_name}</span>}
        {user.role === "admin" && <span className="rounded bg-accent px-1.5 text-xs">{t.roleAdmin}</span>}
      </div>
      <p className="text-sm text-muted-foreground">
        {t.userUsedToday(user.used_today, user.limit_today)}・
        {user.daily_quota_override === null ? t.userDefault : t.userOverride(user.daily_quota_override)}
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={`${user.email} 的每日次數`}
          inputMode="numeric"
          placeholder={t.userSetPlaceholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24"
        />
        <Button type="submit" size="sm" disabled={busy}>{t.userSet}</Button>
        {user.daily_quota_override !== null && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setValue(""); void update(null); }}>
            {t.userReset}
          </Button>
        )}
        <FeedbackLine feedback={feedback} />
      </form>
    </li>
  );
}

function UserQuota() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    if (query.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users?email=${encodeURIComponent(query.trim())}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? t.loadFailed);
        setUsers(null);
      } else {
        setUsers(data.users);
      }
    } catch {
      setError(copy.submit.networkError);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <h3 className="font-medium">{t.userTitle}</h3>
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <Input
          aria-label={t.userSearch}
          placeholder={t.userSearch}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={busy}>{t.userSearchButton}</Button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {users && users.length === 0 && <p className="text-sm text-muted-foreground">{t.userNone}</p>}
      {users && users.length > 0 && (
        <ul className="divide-y rounded border">
          {users.map((u) => (
            // key 帶上額度，重新搜尋後輸入框會顯示最新的值
            <UserRow key={`${u.id}:${u.daily_quota_override}:${u.used_today}`} user={u} onChanged={() => void search()} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function AdminQuota(props: { dailyQuota: number; globalLimit: number; globalUsedToday: number }) {
  return (
    <div className="space-y-4">
      <GlobalSettings {...props} />
      <UserQuota />
    </div>
  );
}
