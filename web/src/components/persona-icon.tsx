// 每位陪審員的職業圖示（PRD 第 7 節：代表職業的物件圖示，不使用真人照片）。
import {
  Armchair, Backpack, BookOpen, Briefcase, CarTaxiFront, CookingPot, Cpu, Feather, GraduationCap, Guitar, Hammer,
  HeartHandshake, Languages, Library, Megaphone, Newspaper, PenLine, Pencil, Scale, Sprout, Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { groupColor } from "@/lib/core/result";
import { personas } from "@/lib/core/shared";

const ICONS: Record<string, LucideIcon> = {
  J01: Feather, J02: BookOpen, J03: PenLine, J04: Library, J05: GraduationCap, J06: Languages,
  J07: Newspaper, J08: Megaphone, J09: HeartHandshake, J10: Cpu, J11: Backpack, J12: Armchair,
  J13: Hammer, J14: Briefcase, J15: Pencil, J16: Sprout, J17: CookingPot, J18: CarTaxiFront, J19: Stethoscope, J20: Guitar,
};

export const personaByCode = Object.fromEntries(personas.map((p) => [p.code, p]));

export const GROUP_STYLES = {
  pro: { border: "border-group-pro", text: "text-group-pro", bg: "bg-group-pro/10" },
  lay: { border: "border-group-lay", text: "text-group-lay", bg: "bg-group-lay/10" },
  cross: { border: "border-group-cross", text: "text-group-cross", bg: "bg-group-cross/10" },
} as const;

export function groupStyle(code: string) {
  return GROUP_STYLES[groupColor(personaByCode[code]?.group ?? "")];
}

/** 圓形的職業圖示。dim 為 true 時顯示為灰色（尚未完成或缺席）。 */
export function PersonaIcon({ code, dim = false, size = "md" }: { code: string; dim?: boolean; size?: "sm" | "md" | "lg" }) {
  const Icon = ICONS[code] ?? Scale;
  const style = groupStyle(code);
  const box = size === "lg" ? "size-14" : size === "sm" ? "size-8" : "size-10";
  const icon = size === "lg" ? "size-7" : size === "sm" ? "size-4" : "size-5";
  return (
    <span
      aria-hidden
      className={`flex ${box} shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-500 ${
        dim ? "border-border bg-muted text-muted-foreground/50" : `${style.border} ${style.bg} ${style.text}`
      }`}
    >
      <Icon className={icon} />
    </span>
  );
}

export function GroupBadge({ code }: { code: string }) {
  const persona = personaByCode[code];
  if (!persona) return null;
  const style = groupStyle(code);
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${style.border} ${style.text}`}>{persona.group}</span>;
}
