"use client";
// 投稿頁的「陪審團」選擇：預設隨機抽選，也可以自己挑。每組人數固定（settings.jury.size_by_group）。
// 沒選滿的名額由伺服器在送出時隨機補上；這裡的限制只是即時提示，伺服器會再檢查一次。
import { Check, Shuffle, X } from "lucide-react";
import { PersonaIcon, groupStyle } from "@/components/persona-icon";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { copy } from "@/lib/copy";
import { GROUPS, personas, settings } from "@/lib/core/shared";

export type JuryChoice = "random" | "choose";

const t = copy.submit;
const active = personas.filter((p) => p.enabled);
const sizeOf = (group: string) => settings.jury.size_by_group[group] ?? 0;
const total = GROUPS.reduce((sum, g) => sum + sizeOf(g), 0);

export function JuryPicker({
  choice,
  onChoice,
  picks,
  onPicks,
}: {
  choice: JuryChoice;
  onChoice: (choice: JuryChoice) => void;
  picks: string[];
  onPicks: (picks: string[]) => void;
}) {
  const groupOf = (code: string) => active.find((p) => p.code === code)?.group;
  const countIn = (group: string, list = picks) => list.filter((code) => groupOf(code) === group).length;

  function toggle(code: string) {
    if (picks.includes(code)) return onPicks(picks.filter((c) => c !== code));
    const group = groupOf(code);
    if (!group || countIn(group) >= sizeOf(group)) return;
    onPicks([...picks, code]);
  }

  /** 每組沒選滿的名額，從還沒選的人裡隨機補上。 */
  function fillRandom() {
    const next = [...picks];
    for (const group of GROUPS) {
      const pool = active.filter((p) => p.group === group && !next.includes(p.code)).map((p) => p.code);
      for (let need = sizeOf(group) - countIn(group, next); need > 0 && pool.length > 0; need -= 1) {
        next.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
    }
    onPicks(next);
  }

  return (
    <fieldset className="space-y-3">
      <legend className="font-medium">{t.juryLegend}</legend>
      <RadioGroup value={choice} onValueChange={(value) => onChoice(value as JuryChoice)} className="flex flex-wrap gap-x-6 gap-y-3">
        <Label className="flex items-center gap-2 font-normal">
          <RadioGroupItem value="random" />
          {t.juryRandom}
        </Label>
        <Label className="flex items-center gap-2 font-normal">
          <RadioGroupItem value="choose" />
          {t.juryChoose}
        </Label>
      </RadioGroup>
      <p className="text-xs text-muted-foreground">
        {choice === "random" ? t.juryRandomHint : t.juryChooseHint(picks.length, total)}
      </p>

      {choice === "choose" && (
        <div className="space-y-4 rounded-xl border bg-card p-4">
          {GROUPS.map((group) => {
            const members = active.filter((p) => p.group === group);
            const full = countIn(group) >= sizeOf(group);
            const style = groupStyle(members[0]?.code ?? "");
            return (
              <section key={group} aria-label={group} className="space-y-2">
                <h3 className={`flex items-center gap-2 text-sm font-semibold ${style.text}`}>
                  {group}
                  <span className="font-normal text-muted-foreground" aria-live="polite">{t.juryGroupCount(countIn(group), sizeOf(group))}</span>
                </h3>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {members.map((p) => {
                    const on = picks.includes(p.code);
                    const disabled = !on && full;
                    const ps = groupStyle(p.code);
                    return (
                      <li key={p.code}>
                        <button
                          type="button"
                          onClick={() => toggle(p.code)}
                          aria-pressed={on}
                          disabled={disabled}
                          className={`relative flex w-full flex-col items-center gap-1 rounded-lg border-2 p-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 ${
                            on ? `${ps.border} ${ps.bg}` : "border-transparent hover:border-border hover:bg-muted/60"
                          }`}
                        >
                          <PersonaIcon code={p.code} size="md" />
                          <span className="font-medium">{p.name}</span>
                          {on && (
                            <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check className="size-3" aria-hidden />
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={fillRandom} disabled={picks.length >= total}>
              <Shuffle aria-hidden />
              {t.juryFill}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onPicks([])} disabled={picks.length === 0}>
              <X aria-hidden />
              {t.juryClear}
            </Button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
