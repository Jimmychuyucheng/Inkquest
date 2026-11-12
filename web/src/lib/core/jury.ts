// 陪審團抽選：依組別分層抽出（每組人數見 settings.jury.size_by_group），以投稿 id 為種子（PRD 第 4 節）。
// 與 research/court/jury.py 使用同一套算法：
// 同組內依 sha256("{投稿 id}:{陪審員編號}") 由小到大排序，取前 n 位。
// 只在伺服器端使用（需要 node:crypto）。
import { createHash } from "node:crypto";
import type { Persona } from "./shared";

export interface JuryConfig {
  size_by_group: Record<string, number>;
}

function rank(seed: string, code: string): string {
  return createHash("sha256").update(`${seed}:${code}`, "utf8").digest("hex");
}

/**
 * 回傳本次的陪審員，依編號排序。停用的人設不列入；某組不足時從其他組補足。
 * picks 是使用者自己選的編號（已通過 validatePicks）：先放進各組，剩下的名額照原本的隨機規則補滿。
 * 沒有 picks 時與 research/court/jury.py 的結果完全相同。
 */
export function drawJury(submissionId: string, personas: Persona[], config: JuryConfig, picks: readonly string[] = []): Persona[] {
  const ranked = personas
    .filter((p) => p.enabled)
    .map((p) => ({ persona: p, key: rank(submissionId, p.code) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((item) => item.persona);

  const chosen: Persona[] = [];
  let total = 0;
  for (const [group, size] of Object.entries(config.size_by_group)) {
    total += size;
    const picked = ranked.filter((p) => p.group === group && picks.includes(p.code)).slice(0, size);
    const rest = ranked.filter((p) => p.group === group && !picks.includes(p.code)).slice(0, size - picked.length);
    chosen.push(...picked, ...rest);
  }

  const shortfall = total - chosen.length;
  if (shortfall > 0) {
    const chosenCodes = new Set(chosen.map((p) => p.code));
    chosen.push(...ranked.filter((p) => !chosenCodes.has(p.code)).slice(0, shortfall));
  }

  return chosen.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export type JuryMode = "random" | "chosen" | "mixed";

/** 依使用者選了幾位，判斷這場陪審團的組成方式（記錄在 submissions.jury_mode，供研究區分）。 */
export function juryMode(picks: readonly string[], config: JuryConfig): JuryMode {
  if (picks.length === 0) return "random";
  const total = Object.values(config.size_by_group).reduce((sum, n) => sum + n, 0);
  return picks.length >= total ? "chosen" : "mixed";
}

/**
 * 檢查使用者自己選的陪審員：必須是啟用中的編號、不重複、每組不超過該組名額。
 * 沒有提供（undefined、null、空陣列）表示隨機抽選。
 */
export function validatePicks(
  value: unknown,
  personas: Persona[],
  config: JuryConfig,
): { ok: true; picks: string[] } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, picks: [] };
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return { ok: false };
  const picks = value as string[];
  if (new Set(picks).size !== picks.length) return { ok: false };
  const byCode = new Map(personas.filter((p) => p.enabled).map((p) => [p.code, p]));
  if (!picks.every((code) => byCode.has(code))) return { ok: false };
  for (const [group, size] of Object.entries(config.size_by_group)) {
    if (picks.filter((code) => byCode.get(code)?.group === group).length > size) return { ok: false };
  }
  if (!picks.every((code) => (config.size_by_group[byCode.get(code)!.group] ?? 0) > 0)) return { ok: false };
  return { ok: true, picks };
}
