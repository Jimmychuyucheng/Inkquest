"use client";
// 首頁的陪審團陣容：遊戲「選擇角色」風格。只是瀏覽角色，不會影響抽選（陪審團仍依規格隨機抽出）。
import { useRef, useState } from "react";
import { GroupBadge, PersonaIcon, groupStyle } from "@/components/persona-icon";
import { copy } from "@/lib/copy";
import { GROUPS, personas, settings } from "@/lib/core/shared";

const t = copy.home;

function splitList(text: string): string[] {
  return text.split(/[、，,]/).map((s) => s.trim()).filter(Boolean);
}

export function JurySelect() {
  const [selected, setSelected] = useState(personas[0].code);
  const cardRef = useRef<HTMLElement>(null);

  /** 選角色。手機上角色卡在格子上方，點了下面的角色會看不到變化，所以卡片不在畫面內時捲上去。 */
  function choose(code: string) {
    setSelected(code);
    const card = cardRef.current;
    if (!card || window.matchMedia("(min-width: 1024px)").matches) return;
    if (card.getBoundingClientRect().bottom < 80) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }
  const persona = personas.find((p) => p.code === selected) ?? personas[0];
  const style = groupStyle(persona.code);

  return (
    <div className="grid gap-6 rounded-2xl border-2 border-primary/15 bg-card p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* 角色卡：手機在上面，寬螢幕在右邊 */}
      <aside
        ref={cardRef}
        aria-live="polite"
        className={`order-first flex scroll-mt-4 flex-col items-center gap-4 rounded-xl border-2 p-5 text-center lg:order-last lg:sticky lg:top-4 lg:self-start ${style.border} ${style.bg}`}
      >
        <p className="text-xs tracking-widest text-muted-foreground">{t.selectedLabel}</p>
        <PersonaIcon key={persona.code} code={persona.code} size="xl" className="animate-idle-bob bg-card" />
        <div className="space-y-1">
          <h3 className="font-heading text-2xl font-semibold">{persona.name}</h3>
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>{persona.code}</span>
            <GroupBadge code={persona.code} />
          </p>
        </div>
        <p className="text-sm leading-relaxed">{persona.background}</p>
        <dl className="w-full space-y-3 text-left text-sm">
          <div>
            <dt className={`mb-1 text-xs font-medium ${style.text}`}>{t.focus}</dt>
            <dd className="flex flex-wrap gap-1.5">
              {splitList(persona.focus).map((item) => (
                <span key={item} className="rounded-full border bg-card px-2.5 py-0.5 text-xs">{item}</span>
              ))}
            </dd>
          </div>
          <div>
            <dt className={`mb-1 text-xs font-medium ${style.text}`}>{t.tone}</dt>
            <dd>{persona.tone}</dd>
          </div>
        </dl>
      </aside>

      <div className="space-y-5">
        {GROUPS.map((group) => {
          const members = personas.filter((p) => p.group === group);
          const groupStyles = groupStyle(members[0]?.code ?? "");
          return (
            <section key={group} aria-label={group} className="space-y-2">
              <h3 className={`flex items-center gap-2 text-sm font-semibold ${groupStyles.text}`}>
                <span className={`inline-block h-1 w-6 rounded-full ${groupStyles.bg} border ${groupStyles.border}`} aria-hidden />
                {group}
                <span className="font-normal text-muted-foreground">{t.groupPick(members.length, settings.jury.size_by_group[group] ?? 0)}</span>
              </h3>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {members.map((p) => {
                  const active = p.code === selected;
                  return (
                    <li key={p.code}>
                      <button
                        type="button"
                        onClick={() => choose(p.code)}
                        aria-pressed={active}
                        className={`group flex w-full flex-col items-center gap-1 rounded-xl border-2 p-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          active
                            ? `${groupStyle(p.code).border} ${groupStyle(p.code).bg} -translate-y-0.5 shadow-md`
                            : "border-transparent hover:-translate-y-0.5 hover:border-border hover:bg-muted/60"
                        }`}
                      >
                        <PersonaIcon code={p.code} size="lg" />
                        <span className="text-xs font-medium sm:text-sm">{p.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
