// 開庭流程（PRD 第 5 節的處理步驟）。這裡只有流程，不直接碰資料庫與模型：
// 資料存取經由 CourtStore、模型經由 LLMProvider，所以可以用假資料完整測試。
// 每個階段是獨立的函式，背景工作（Inngest）把它們當作一個個步驟執行；
// 每個階段都可以安全地重跑（已完成的陪審員不會重新呼叫）。
import { drawJury } from "@/lib/core/jury";
import type { AdviceOutput, JudgeOutput } from "@/lib/core/schemas";
import { GROUPS, type Persona, type Settings } from "@/lib/core/shared";
import { computeStats, type SessionStats } from "@/lib/core/stats";
import type { LLMProvider } from "@/lib/llm/types";
import { buildJuryPayload, runAdvice, runJudge, runJuror, type Article, type CallResult, type JurorResult } from "./run";

export type SubmissionStatus = "queued" | "jurors_running" | "judge_running" | "advice_running" | "done" | "failed";

/** 失敗原因代碼；給使用者看的說明在 copy.ts（failureMessage）。 */
export type FailureCode = "jurors_failed" | "judge_failed" | "internal";

export interface SubmissionRecord extends Article {
  id: string;
  modules: string[];
  status: SubmissionStatus;
  jury: string[];
}

export interface SubmissionPatch {
  status?: SubmissionStatus;
  jury?: string[];
  jurors_ok?: number;
  stats?: SessionStats;
  error?: FailureCode | null;
  finished_at?: string;
}

export interface CourtStore {
  /** 找不到（例如使用者已刪除）時回傳 null。 */
  getSubmission(id: string): Promise<SubmissionRecord | null>;
  updateSubmission(id: string, patch: SubmissionPatch): Promise<void>;
  getJurorResults(id: string): Promise<JurorResult[]>;
  /** 同一位陪審員重複寫入時覆蓋。 */
  saveJurorResult(id: string, result: JurorResult): Promise<void>;
  getVerdict(id: string): Promise<JudgeOutput | null>;
  saveVerdict(id: string, result: CallResult<JudgeOutput>): Promise<void>;
  hasAdvice(id: string): Promise<boolean>;
  saveAdvice(id: string, result: CallResult<AdviceOutput>): Promise<void>;
}

export interface CourtDeps {
  store: CourtStore;
  provider: LLMProvider;
  settings: Settings;
  personas: Persona[];
  now?: () => Date;
}

/** 階段結果：proceed 為 false 表示流程到此為止（失敗、或投稿已不存在）。 */
export interface PhaseResult {
  proceed: boolean;
  note: string;
}

const stop = (note: string): PhaseResult => ({ proceed: false, note });
const go = (note: string): PhaseResult => ({ proceed: true, note });
const ACTIVE: SubmissionStatus[] = ["queued", "jurors_running", "judge_running", "advice_running"];

async function loadActive(id: string, deps: CourtDeps): Promise<SubmissionRecord | null> {
  const submission = await deps.store.getSubmission(id);
  return submission && ACTIVE.includes(submission.status) ? submission : null;
}

export async function failCourt(id: string, code: FailureCode, deps: Pick<CourtDeps, "store" | "now">): Promise<void> {
  // 狀態 failed 的投稿不計入額度，等於退回這一次
  await deps.store.updateSubmission(id, {
    status: "failed",
    error: code,
    finished_at: (deps.now?.() ?? new Date()).toISOString(),
  });
}

/** 第 2 步前半：抽出陪審團，狀態改為 jurors_running。 */
export async function startCourt(id: string, deps: CourtDeps): Promise<PhaseResult> {
  const submission = await loadActive(id, deps);
  if (!submission) return stop("投稿不存在或已結束");
  const jury = drawJury(id, deps.personas, deps.settings.jury).map((p) => p.code);
  await deps.store.updateSubmission(id, { status: "jurors_running", jury });
  return go(`抽出 ${jury.length} 位陪審員`);
}

/** 同時最多執行 limit 個工作。 */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await worker(item);
  });
  await Promise.all(runners);
}

/** 第 2～4 步：陪審員並行評閱，每位完成就寫入；成功數不足則整次失敗。 */
export async function runJurorPhase(id: string, deps: CourtDeps): Promise<PhaseResult> {
  const submission = await loadActive(id, deps);
  if (!submission) return stop("投稿不存在或已結束");
  const { store, settings, provider } = deps;
  const personaByCode = Object.fromEntries(deps.personas.map((p) => [p.code, p]));
  const finished = new Set((await store.getJurorResults(id)).map((r) => r.jurorCode));
  const pending = submission.jury.filter((code) => !finished.has(code)).map((code) => personaByCode[code]);

  await runPool(pending, settings.jury.concurrency, async (persona) => {
    let result: JurorResult;
    try {
      result = await runJuror(persona, submission, settings, provider);
    } catch (error) {
      // 非預期的錯誤只影響這一位，不讓其他陪審員的結果白費
      console.error(`陪審員 ${persona.code} 發生非預期錯誤`, error instanceof Error ? error.name : "");
      result = {
        jurorCode: persona.code, personaVersion: persona.version, status: "failed", output: null,
        model: settings.models.juror, inputTokens: 0, outputTokens: 0, latencyMs: 0, attempts: 1,
        error: "非預期的錯誤", attemptErrors: ["非預期的錯誤"],
      };
    }
    await store.saveJurorResult(id, result);
  });

  const ok = (await store.getJurorResults(id)).filter((r) => r.status === "ok").length;
  await store.updateSubmission(id, { jurors_ok: ok });
  if (ok < settings.jury.min_success) {
    await failCourt(id, "jurors_failed", deps);
    return stop(`只有 ${ok} 位陪審員完成，少於 ${settings.jury.min_success} 位`);
  }
  return go(`${ok} 位陪審員完成`);
}

/** 第 5～6 步：程式計算統計，呼叫法官。 */
export async function runJudgePhase(id: string, deps: CourtDeps): Promise<PhaseResult> {
  const submission = await loadActive(id, deps);
  if (!submission) return stop("投稿不存在或已結束");
  const { store, settings, provider } = deps;
  if (await store.getVerdict(id)) return go("判決已存在");

  const personaByCode = Object.fromEntries(deps.personas.map((p) => [p.code, p]));
  const payload = buildJuryPayload(await store.getJurorResults(id), personaByCode);
  const stats = computeStats(
    payload.map((j) => ({ code: j.code, group: personaByCode[j.code].group, score: j.score, would_support_award: j.would_support_award, tags: j.tags })),
    GROUPS,
    settings.stats,
  );
  await store.updateSubmission(id, { status: "judge_running", stats });

  const result = await runJudge(submission, payload, stats, settings, provider);
  if (result.status !== "ok" || !result.output) {
    await failCourt(id, "judge_failed", deps);
    return stop(`法官失敗：${result.error ?? ""}`);
  }
  await store.saveVerdict(id, result);
  return go("判決完成");
}

/**
 * 第 7 步：修改建議（只在勾選時執行，每篇最多一筆）。
 * 修改建議失敗不影響判決：投稿仍然完成，只是沒有修改建議。
 */
export async function runAdvicePhase(id: string, deps: CourtDeps): Promise<PhaseResult> {
  const submission = await loadActive(id, deps);
  if (!submission) return stop("投稿不存在或已結束");
  if (!submission.modules.includes("advice")) return go("沒有勾選修改建議");
  const { store, settings, provider } = deps;
  if (await store.hasAdvice(id)) return go("修改建議已存在");
  const verdict = await store.getVerdict(id);
  if (!verdict) return go("沒有判決，略過修改建議");

  await store.updateSubmission(id, { status: "advice_running" });
  const personaByCode = Object.fromEntries(deps.personas.map((p) => [p.code, p]));
  const payload = buildJuryPayload(await store.getJurorResults(id), personaByCode);
  const result = await runAdvice(submission, verdict, payload, settings, provider);
  if (result.status !== "ok" || !result.output) return go(`修改建議沒有成功：${result.error ?? ""}`);
  await store.saveAdvice(id, result);
  return go("修改建議完成");
}

/** 第 8 步：完成。 */
export async function finishCourt(id: string, deps: CourtDeps): Promise<PhaseResult> {
  const submission = await loadActive(id, deps);
  if (!submission) return stop("投稿不存在或已結束");
  await deps.store.updateSubmission(id, { status: "done", finished_at: (deps.now?.() ?? new Date()).toISOString() });
  return go("完成");
}

export const PHASES = [
  ["start", startCourt],
  ["jurors", runJurorPhase],
  ["judge", runJudgePhase],
  ["advice", runAdvicePhase],
  ["finish", finishCourt],
] as const;

/** 依序執行所有階段（測試與本機腳本用；正式環境由背景工作逐步執行）。 */
export async function runCourt(id: string, deps: CourtDeps): Promise<PhaseResult> {
  let last = go("");
  for (const [, phase] of PHASES) {
    last = await phase(id, deps);
    if (!last.proceed) break;
  }
  return last;
}
