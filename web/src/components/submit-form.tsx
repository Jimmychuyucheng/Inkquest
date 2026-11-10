"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { copy } from "@/lib/copy";
import { GENRES, settings } from "@/lib/core/shared";
import { countChars, countLines } from "@/lib/core/text";

// 基本投稿表單：伺服器端檢查 → 額度 → 建立投稿 → 前往開庭頁。
// 版面、草稿與完整的互動在 W3 完成。
export function SubmitForm({ remaining, limit }: { remaining: number; limit: number }) {
  const t = copy.submit;
  const router = useRouter();
  const [genre, setGenre] = useState(GENRES[0]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [modules, setModules] = useState<string[]>(settings.web.default_modules);
  const [left, setLeft] = useState(remaining);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const rule = settings.genres[genre];
  const chars = countChars(content);
  const lines = countLines(content);
  const outOfRange =
    chars < rule.min_chars || chars > rule.max_chars || (rule.max_lines != null && lines > rule.max_lines);
  const canSend = !busy && left > 0 && !outOfRange && modules.length > 0;

  function toggle(module: string) {
    setModules((current) =>
      current.includes(module) ? current.filter((m) => m !== module) : [...current, module],
    );
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
      if (response.ok) {
        setLeft((n) => Math.max(n - 1, 0));
        setMessage({ kind: "ok", text: t.queued });
        if (typeof data.id === "string") router.push(`/court/${data.id}`);
      } else {
        setMessage({ kind: "error", text: data.message ?? copy.errors.generic });
      }
    } catch {
      setMessage({ kind: "error", text: t.networkError });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="space-y-5">
      <p className="text-sm text-stone-600" aria-live="polite">
        {t.remaining(left, limit)}
      </p>

      <fieldset>
        <legend className="mb-2 font-medium">{t.genre}</legend>
        <div className="flex flex-wrap gap-4">
          {GENRES.map((g) => (
            <label key={g} className="flex items-center gap-1.5">
              <input type="radio" name="genre" checked={genre === g} onChange={() => setGenre(g)} />
              {g}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-2 block font-medium">{t.titleLabel}</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          className="w-full rounded border border-stone-300 px-3 py-2"
        />
      </label>

      <label className="block">
        <span className="mb-2 block font-medium">{t.content}</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={14}
          className="w-full rounded border border-stone-300 px-3 py-2 font-serif leading-relaxed"
        />
        <span className={`mt-1 block text-sm ${outOfRange ? "text-red-700" : "text-stone-600"}`}>
          {t.chars(chars)}（{genre}需 {rule.min_chars}～{rule.max_chars} 字
          {rule.max_lines != null ? `，最多 ${rule.max_lines} 行，目前 ${lines} 行` : ""}）
        </span>
        <span className="mt-1 block text-xs text-stone-500">{t.privacyHint}</span>
      </label>

      <fieldset>
        <legend className="mb-2 font-medium">{t.modules}</legend>
        <div className="space-y-1.5">
          {settings.web.modules.map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input type="checkbox" checked={modules.includes(m)} onChange={() => toggle(m)} />
              {t.moduleNames[m] ?? m}
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={!canSend}
        className="rounded bg-stone-900 px-5 py-2.5 text-white disabled:opacity-50"
      >
        {busy ? t.sending : t.send}
      </button>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"}
           className={`whitespace-pre-line text-sm ${message.kind === "error" ? "text-red-700" : "text-green-800"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
