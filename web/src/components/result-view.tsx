"use client";
// 結果頁（PRD 第 7 節「結果頁由上到下」）。
import { Check, ChevronDown, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WaitForStatus } from "@/components/court-progress";
import { GroupBadge, PersonaIcon, groupStyle, personaByCode } from "@/components/persona-icon";
import { ScoreChart } from "@/components/score-chart";
import { Button, buttonVariants } from "@/components/ui/button";
import { copy } from "@/lib/copy";
import { formatRatio, formatScore, moduleView, splitByJurorCodes, verdictCopyText, type ModuleName } from "@/lib/core/result";
import type { AdviceOutput, JudgeOutput, JurorOutput } from "@/lib/core/schemas";
import { GROUPS } from "@/lib/core/shared";
import type { SessionStats } from "@/lib/core/stats";

export interface ResultData {
  id: string;
  title: string;
  status: string;
  modules: string[];
  jury: string[];
  stats: SessionStats | null;
  jurors: { juror_code: string; status: string; output: JurorOutput | null }[];
  verdict: JudgeOutput;
  advice: AdviceOutput | null;
}

const t = copy.result;

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-4">
      <h2 className="border-b border-brass/40 pb-2 font-heading text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function PointList({ title, items }: { title: string; items: { point: string; quote: string }[] }) {
  return (
    <div>
      <h4 className="mb-1 text-sm font-medium">{title}</h4>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="text-sm leading-relaxed">
            {item.point}
            {item.quote && (
              <blockquote className="mt-1 border-l-2 border-brass/60 pl-3 font-serif text-muted-foreground">{item.quote}</blockquote>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function JurorCard({
  code,
  juror,
  expanded,
  onToggle,
}: {
  code: string;
  juror: ResultData["jurors"][number] | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const persona = personaByCode[code];
  const output = juror?.status === "ok" ? juror.output : null;
  if (!output) {
    // 失敗的陪審員顯示為灰色「本次缺席」
    return (
      <li id={`juror-${code}`} className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/50 p-4 text-muted-foreground">
        <PersonaIcon code={code} dim />
        <span className="font-medium">{persona?.name ?? code}</span>
        <span className="text-sm">{t.absent}</span>
      </li>
    );
  }
  const style = groupStyle(code);
  return (
    <li id={`juror-${code}`} className={`scroll-mt-4 rounded-lg border-l-4 border bg-card ${style.border}`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-start gap-3 p-4 text-left">
        <PersonaIcon code={code} />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{persona?.name ?? code}</span>
            <span className="text-xs text-muted-foreground">{code}</span>
            <GroupBadge code={code} />
          </span>
          <span className="block text-sm leading-relaxed">{output.one_line}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-heading text-2xl font-semibold leading-none">{output.score}</span>
          {output.would_support_award ? (
            <ThumbsUp className="size-4 text-group-lay" aria-label={t.supportYes} />
          ) : (
            <ThumbsDown className="size-4 text-muted-foreground" aria-label={t.supportNo} />
          )}
        </span>
        <ChevronDown className={`mt-1 size-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
        <span className="sr-only">{expanded ? t.collapse : t.expand}</span>
      </button>
      {expanded && (
        <div className="space-y-4 border-t px-4 py-4">
          <p className="font-serif leading-loose">{output.comment}</p>
          <PointList title={t.jurorStrengths} items={output.strengths} />
          <PointList title={t.jurorWeaknesses} items={output.weaknesses} />
          <ul className="flex flex-wrap gap-2">
            {output.tags.map((tag) => (
              <li key={tag} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">{tag}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function ResultView({ data }: { data: ResultData }) {
  const router = useRouter();
  const view = moduleView(data.modules);
  const { verdict, stats } = data;
  const [jurorsOpen, setJurorsOpen] = useState(view.jurorsOpen);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<ModuleName | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const adviceRunning = data.status === "advice_running";
  const okCount = data.jurors.filter((j) => j.status === "ok").length;
  const jurorByCode = Object.fromEntries(data.jurors.map((j) => [j.juror_code, j]));

  function toggle(code: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  /** 點判決書裡的編號：展開卡片區、展開那一張，並捲動過去。 */
  function jumpTo(code: string) {
    setJurorsOpen(true);
    setExpanded((current) => new Set(current).add(code));
    // 等卡片畫出來再捲動
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.getElementById(`juror-${code}`)?.scrollIntoView({ behavior: "smooth", block: "start" })),
    );
  }

  async function addModule(name: ModuleName) {
    setAdding(name);
    setNotice(null);
    try {
      const response = await fetch(`/api/submissions/${data.id}/modules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: name }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setNotice(body.message ?? copy.errors.generic);
      else router.refresh();
    } catch {
      setNotice(copy.submit.networkError);
    } finally {
      setAdding(null);
    }
  }

  async function copyVerdict() {
    try {
      await navigator.clipboard.writeText(verdictCopyText(data.title, verdict, copy.disclaimer));
      setCopied("ok");
      setTimeout(() => setCopied("idle"), 2500);
    } catch {
      setCopied("failed");
    }
  }

  const linked = (text: string) =>
    splitByJurorCodes(text, data.jury).map((segment, index) =>
      segment.type === "text" ? (
        <span key={index}>{segment.text}</span>
      ) : (
        <button
          key={index}
          type="button"
          onClick={() => jumpTo(segment.code)}
          className={`rounded px-0.5 font-sans text-[0.9em] font-medium underline decoration-dotted underline-offset-4 ${groupStyle(segment.code).text}`}
          title={personaByCode[segment.code]?.name}
        >
          {segment.code}
        </button>
      ),
    );

  return (
    <div className="space-y-10">
      {adviceRunning && <WaitForStatus id={data.id} whileStatus="advice_running" />}

      {verdict.author_wellbeing_flag && (
        <p role="note" className="rounded-lg border border-group-lay/40 bg-group-lay/10 p-4 leading-relaxed">{t.wellbeing}</p>
      )}

      {/* 1. 判決橫幅 */}
      <header className="rounded-xl bg-primary p-6 text-primary-foreground sm:p-8">
        <p className="text-sm opacity-80">{data.title || t.untitled}</p>
        <h1 className="mt-2 font-heading text-2xl font-semibold leading-snug sm:text-3xl">{verdict.headline}</h1>
        {view.scores && stats && (
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="opacity-70">{t.meanScore}</dt>
              <dd className="font-heading text-3xl font-semibold">{formatScore(stats.mean_score)}</dd>
            </div>
            <div>
              <dt className="opacity-70">{t.support(stats.support_count, stats.juror_count)}</dt>
              <dd className="mt-1 text-base">{stats.potential_label}</dd>
            </div>
          </dl>
        )}
        {okCount < data.jury.length && <p className="mt-4 text-sm opacity-80">{t.partialJury(okCount)}</p>}
      </header>

      {/* 2. 法官總評 */}
      <Section title={t.verdictTitle}>
        <p className="whitespace-pre-wrap font-serif text-[1.05rem] leading-loose">{linked(verdict.verdict)}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">{t.strengths}</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {verdict.top_strengths.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">{t.weaknesses}</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {verdict.top_weaknesses.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      </Section>

      {/* 3. 少數意見與最大分歧 */}
      <Section title={t.minorityTitle}>
        <div className="rounded-lg border border-brass/50 bg-secondary/50 p-5">
          {verdict.minority_jurors.length > 0 ? (
            <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t.minorityJurors}：</span>
              {verdict.minority_jurors.map((code) => (
                <button key={code} type="button" onClick={() => jumpTo(code)} className="flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-0.5 pr-2.5">
                  <PersonaIcon code={code} size="sm" />
                  {personaByCode[code]?.name ?? code}
                </button>
              ))}
            </p>
          ) : (
            <p className="mb-3 text-sm text-muted-foreground">{t.unanimous}</p>
          )}
          <p className="whitespace-pre-wrap font-serif leading-loose">{linked(verdict.minority_opinion)}</p>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-medium">{t.disagreementTitle}</h3>
          <p className="font-serif leading-loose">{linked(verdict.biggest_disagreement)}</p>
        </div>
      </Section>

      {/* 4. 分數與得獎潛力 */}
      {view.scores && stats && (
        <Section title={t.scoresTitle}>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium">{t.distribution}</h3>
              <ScoreChart distribution={stats.distribution} />
            </div>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="mb-1 font-medium">{t.groupMeans}</dt>
                <dd className="grid grid-cols-3 gap-2">
                  {GROUPS.map((group) => {
                    const style = groupStyle(personaCodeOfGroup(group));
                    const mean = stats.group_means[group];
                    return (
                      <span key={group} className={`rounded-lg border-t-4 border bg-card p-2 text-center ${style.border}`}>
                        <span className="block text-xs text-muted-foreground">{group}</span>
                        <span className="font-heading text-xl font-semibold">{mean == null ? t.noGroupMean : formatScore(mean)}</span>
                      </span>
                    );
                  })}
                </dd>
              </div>
              <div className="flex gap-8">
                <div>
                  <dt className="font-medium">{t.support(stats.support_count, stats.juror_count)}</dt>
                  <dd>{formatRatio(stats.support_ratio)}・{stats.potential_label}</dd>
                </div>
                <div>
                  <dt className="font-medium">{t.controversy}</dt>
                  <dd>{stats.controversy}</dd>
                </div>
              </div>
              <div>
                <dt className="mb-1 font-medium">{t.topTags}</dt>
                <dd className="flex flex-wrap gap-2">
                  {stats.top_tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">{tag}</span>
                  ))}
                </dd>
              </div>
            </dl>
          </div>
        </Section>
      )}

      {/* 5. 具體修改建議 */}
      {view.advice && (
        <Section title={t.adviceTitle}>
          {data.advice ? (
            <ol className="space-y-4">
              {data.advice.suggestions.map((item, index) => (
                <li key={index} className="space-y-3 rounded-lg border bg-card p-5">
                  <blockquote className="border-l-4 border-brass/60 pl-4 font-serif leading-loose">{item.quote}</blockquote>
                  <p className="text-sm leading-relaxed"><span className="font-medium">{t.adviceIssue}：</span>{item.issue}</p>
                  <p className="text-sm leading-relaxed"><span className="font-medium">{t.adviceDirection}：</span>{item.direction}</p>
                  {item.example && (
                    <p className="rounded bg-muted p-3 text-sm leading-relaxed">
                      <span className="mb-1 block text-xs text-muted-foreground">{t.adviceExample}</span>
                      <span className="font-serif">{item.example}</span>
                    </p>
                  )}
                  {item.raised_by.length > 0 && (
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {t.adviceRaisedBy}：
                      {item.raised_by.map((code) => (
                        <button key={code} type="button" onClick={() => jumpTo(code)} className={`underline decoration-dotted underline-offset-4 ${groupStyle(code).text}`}>
                          {personaByCode[code]?.name ?? code}
                        </button>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground" role="status">{adviceRunning ? t.adviceGenerating : copy.court.adviceMissing}</p>
          )}
        </Section>
      )}

      {/* 6. 查看所有職業意見 */}
      <Section title={t.jurorsTitle} id="jurors">
        <Button variant="outline" onClick={() => setJurorsOpen((open) => !open)} aria-expanded={jurorsOpen}>
          {jurorsOpen ? t.hideJurors : t.showJurors}
        </Button>
        {jurorsOpen && (
          <ul className="space-y-3">
            {data.jury.map((code) => (
              <JurorCard key={code} code={code} juror={jurorByCode[code]} expanded={expanded.has(code)} onToggle={() => toggle(code)} />
            ))}
          </ul>
        )}
      </Section>

      {/* 7. 未勾選的模組 */}
      {view.addable.length > 0 && !adviceRunning && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t.alsoWant}</h2>
          <div className="flex flex-wrap gap-2">
            {view.addable.map((name) => (
              <Button key={name} variant="secondary" disabled={adding !== null} onClick={() => addModule(name)}>
                {adding === name ? t.adding : copy.submit.moduleNames[name]}
              </Button>
            ))}
          </div>
          {notice && <p role="alert" className="text-sm text-destructive">{notice}</p>}
        </section>
      )}

      {/* 8. 頁尾 */}
      <footer className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button variant="outline" onClick={copyVerdict}>
          {copied === "ok" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied === "ok" ? t.copied : t.copyVerdict}
        </Button>
        <Link href="/submit" className={buttonVariants()}>{t.again}</Link>
        <Link href="/history" className={buttonVariants({ variant: "ghost" })}>{t.toHistory}</Link>
        {copied === "failed" && <p role="alert" className="w-full text-sm text-destructive">{t.copyFailed}</p>}
      </footer>
    </div>
  );
}

/** 取該組任一位陪審員的編號，用來查組別識別色。 */
function personaCodeOfGroup(group: string): string {
  return Object.values(personaByCode).find((p) => p.group === group)?.code ?? "";
}
