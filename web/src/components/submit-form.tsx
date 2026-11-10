"use client";
// 投稿頁（PRD 第 7 節）：文類、標題、內文（即時字數）、回饋模組、剩餘次數、送出。
// 這裡的檢查只是為了即時提示；伺服器會全部再檢查一次。
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { copy } from "@/lib/copy";
import { GENRES, settings } from "@/lib/core/shared";
import { checkSubmission, countChars, countLines } from "@/lib/core/text";

const MODULES_KEY = "inkquest.modules";

/** 讀回上次勾選的模組（B-5）。只接受目前仍存在的模組名稱。 */
function rememberedModules(): string[] | null {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(MODULES_KEY) ?? "null");
    if (!Array.isArray(saved)) return null;
    const valid = saved.filter((m): m is string => typeof m === "string" && settings.web.modules.includes(m));
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

export function SubmitForm({ remaining, limit }: { remaining: number; limit: number }) {
  const t = copy.submit;
  const router = useRouter();
  const [genre, setGenre] = useState(GENRES[0]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [modules, setModules] = useState<string[]>(settings.web.default_modules);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // 瀏覽器端才讀得到 localStorage，所以在畫面載入後再套用上次的選擇
  useEffect(() => {
    const saved = rememberedModules();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setModules(saved);
  }, []);

  const rule = settings.genres[genre];
  const chars = countChars(content);
  const lines = countLines(content);
  const problems = content.trim() === "" ? [] : checkSubmission(genre, content, settings);
  const outOfRange = content.trim() === "" || problems.length > 0;
  const canSend = !busy && remaining > 0 && !outOfRange && modules.length > 0;

  function toggle(module: string, checked: boolean) {
    setModules((current) => {
      const next = checked ? [...new Set([...current, module])] : current.filter((m) => m !== module);
      try {
        window.localStorage.setItem(MODULES_KEY, JSON.stringify(next));
      } catch {
        // 無法寫入（例如無痕模式）時不影響投稿
      }
      return next;
    });
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genre, title, content, modules }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && typeof data.id === "string") {
        setMessage({ kind: "ok", text: t.queued });
        router.push(`/result/${data.id}`);
        return; // 保持送出中的狀態直到換頁，避免重複送出
      }
      setMessage({ kind: "error", text: data.message ?? copy.errors.generic });
    } catch {
      setMessage({ kind: "error", text: t.networkError });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={send} className="space-y-7">
      <fieldset className="space-y-3">
        <legend className="font-medium">{t.genre}</legend>
        <RadioGroup value={genre} onValueChange={(value) => setGenre(String(value))} className="flex flex-wrap gap-x-6 gap-y-3">
          {GENRES.map((g) => (
            <Label key={g} className="flex items-center gap-2 font-normal">
              <RadioGroupItem value={g} />
              {g}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="title">{t.titleLabel}</Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} className="bg-card" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="content">{t.content}</Label>
        <Textarea
          id="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={16}
          aria-describedby="content-count content-hint"
          aria-invalid={problems.length > 0}
          className="bg-card font-serif text-base leading-loose"
        />
        <p id="content-count" className={`text-sm ${problems.length > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`} aria-live="polite">
          {t.chars(chars)}（{genre}需 {rule.min_chars}～{rule.max_chars} 字
          {rule.max_lines != null ? `，最多 ${rule.max_lines} 行，目前 ${lines} 行` : ""}）
          {problems.length > 0 && <span className="block">{problems.join(" ")}</span>}
        </p>
        <p id="content-hint" className="text-xs text-muted-foreground">{t.privacyHint}</p>
      </div>

      <fieldset className="space-y-3">
        <legend className="font-medium">{t.modules}</legend>
        {settings.web.modules.map((m) => (
          <Label key={m} className="flex items-center gap-2 font-normal">
            <Checkbox checked={modules.includes(m)} onCheckedChange={(checked) => toggle(m, checked === true)} />
            {t.moduleNames[m] ?? m}
            {m === "advice" && <span className="text-xs text-muted-foreground">{t.adviceNote}</span>}
          </Label>
        ))}
        {modules.length === 0 && <p className="text-sm text-destructive">{t.needModule}</p>}
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={!canSend}>{busy ? t.sending : t.send}</Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">{t.remaining(remaining, limit)}</p>
      </div>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"}
           className={`whitespace-pre-line text-sm ${message.kind === "error" ? "text-destructive" : "text-group-lay"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
