// 陪審團抽選：20 選 10，依組別分層，以投稿 id 為種子（PRD 第 4 節）。
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

/** 回傳本次抽中的陪審員，依編號排序。停用的人設不列入；某組不足時從其他組補足。 */
export function drawJury(submissionId: string, personas: Persona[], config: JuryConfig): Persona[] {
  const ranked = personas
    .filter((p) => p.enabled)
    .map((p) => ({ persona: p, key: rank(submissionId, p.code) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((item) => item.persona);

  const chosen: Persona[] = [];
  let total = 0;
  for (const [group, size] of Object.entries(config.size_by_group)) {
    total += size;
    chosen.push(...ranked.filter((p) => p.group === group).slice(0, size));
  }

  const shortfall = total - chosen.length;
  if (shortfall > 0) {
    const chosenCodes = new Set(chosen.map((p) => p.code));
    chosen.push(...ranked.filter((p) => !chosenCodes.has(p.code)).slice(0, shortfall));
  }

  return chosen.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
