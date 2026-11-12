// 每位陪審員的角色圖（像素風人物，圖檔在 public/jurors/J01.png 起，每位一張，產品負責人提供）。
// 外框用組別識別色，一眼看出是哪一組。
import { groupColor } from "@/lib/core/result";
import { personas } from "@/lib/core/shared";

export const personaByCode = Object.fromEntries(personas.map((p) => [p.code, p]));

export const GROUP_STYLES = {
  pro: { border: "border-group-pro", text: "text-group-pro", bg: "bg-group-pro/10", ring: "ring-group-pro" },
  lay: { border: "border-group-lay", text: "text-group-lay", bg: "bg-group-lay/10", ring: "ring-group-lay" },
  cross: { border: "border-group-cross", text: "text-group-cross", bg: "bg-group-cross/10", ring: "ring-group-cross" },
} as const;

export function groupStyle(code: string) {
  return GROUP_STYLES[groupColor(personaByCode[code]?.group ?? "")];
}

export function personaImage(code: string): string {
  return `/jurors/${code}.png`;
}

const SIZES = {
  sm: "size-8 rounded-md border",
  md: "size-12 rounded-lg border-2",
  lg: "size-16 rounded-xl border-2",
  xl: "size-28 rounded-2xl border-[3px] sm:size-36",
} as const;

/**
 * 方形的角色頭像。dim 為 true 時顯示為灰色（尚未完成或缺席）。
 * 旁邊一定會寫出職業名稱，所以圖片本身當作裝飾（alt 留空），螢幕閱讀器不會重複唸。
 */
export function PersonaIcon({
  code,
  dim = false,
  size = "md",
  className = "",
}: {
  code: string;
  dim?: boolean;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const style = groupStyle(code);
  return (
    <span
      aria-hidden
      className={`relative block shrink-0 overflow-hidden transition-[filter,opacity,border-color] duration-500 ${SIZES[size]} ${
        dim ? "border-border bg-muted opacity-50 grayscale" : `${style.border} ${style.bg}`
      } ${className}`}
    >
      {/* 不用 next/image：圖檔很小（每張約 5KB），不需要另外最佳化 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={personaImage(code)} alt="" width={390} height={390} loading="lazy" decoding="async" className="size-full object-contain" />
    </span>
  );
}

export function GroupBadge({ code }: { code: string }) {
  const persona = personaByCode[code];
  if (!persona) return null;
  const style = groupStyle(code);
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${style.border} ${style.text}`}>{persona.group}</span>;
}
