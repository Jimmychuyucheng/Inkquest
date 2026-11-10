// 單次角色呼叫：組 prompt → 呼叫模型 → 驗證 JSON → 不合格就把原因告訴模型並重試。
// 與 research/court/juror.py、judge.py 的流程相同。
import {
  OutputInvalid,
  adviceApiSchema,
  parseAdviceOutput,
  parseJudgeOutput,
  parseJurorOutput,
  toApiSchema,
  type AdviceOutput,
  type JudgeOutput,
  type JurorOutput,
} from "@/lib/core/schemas";
import { schemas, type Persona, type RoleConfig, type Settings } from "@/lib/core/shared";
import type { SessionStats } from "@/lib/core/stats";
import { LLMCallError, type LLMProvider, type LLMRequest } from "@/lib/llm/types";
import {
  buildAdvicePrompts,
  buildJudgePrompts,
  buildJurorSystem,
  buildJurorUser,
  collectWeaknesses,
  type JuryPayloadItem,
} from "./prompts";

export interface Article {
  genre: string;
  title: string;
  content: string;
}

export interface CallResult<T> {
  status: "ok" | "failed";
  output: T | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  attempts: number;
  error: string | null;
  /** 每次失敗嘗試的原因（即使最後成功也保留）。 */
  attemptErrors: string[];
}

export interface JurorResult extends CallResult<JurorOutput> {
  jurorCode: string;
  personaVersion: number;
}

interface CallSpec<T> {
  provider: LLMProvider;
  config: RoleConfig;
  model: string;
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  meta: Record<string, unknown>;
  parse: (text: string) => T;
}

async function callWithRetry<T>(spec: CallSpec<T>): Promise<CallResult<T>> {
  const { provider, config } = spec;
  const result: CallResult<T> = {
    status: "failed",
    output: null,
    model: spec.model,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    attempts: 0,
    error: null,
    attemptErrors: [],
  };
  let retryNote = "";

  for (let attempt = 1; attempt <= config.max_retries + 1; attempt += 1) {
    result.attempts = attempt;
    const request: LLMRequest = {
      model: spec.model,
      system: spec.system,
      user: spec.user + retryNote,
      maxTokens: config.max_tokens,
      timeoutSeconds: config.timeout_seconds,
      thinking: config.thinking,
      effort: config.effort ?? null,
      jsonSchema: spec.jsonSchema,
      meta: spec.meta,
    };
    try {
      const response = await provider.complete(request);
      result.inputTokens += response.inputTokens;
      result.outputTokens += response.outputTokens;
      result.latencyMs += response.latencyMs;
      result.model = response.model;
      if (response.stopReason === "max_tokens") throw new OutputInvalid("輸出太長，在寫完之前就被截斷");
      result.output = spec.parse(response.text);
    } catch (error) {
      if (error instanceof OutputInvalid) {
        result.error = error.message;
        result.attemptErrors.push(error.message);
        // 重試時告訴模型上次哪裡不合格（放在資料區塊之後，屬於我們的指示）
        retryNote =
          `\n\n注意：你上一次的輸出被退回，原因是：${error.message}。` +
          "請針對這個原因修正，其他內容可以保留，然後重新輸出完整的 JSON。";
        continue;
      }
      if (error instanceof LLMCallError) {
        result.error = error.message;
        result.attemptErrors.push(error.message);
        if (!error.retryable) break;
        continue;
      }
      throw error;
    }
    result.status = "ok";
    result.error = null;
    break;
  }
  return result;
}

const apiSchema = (name: string) => toApiSchema(schemas[name]);

export async function runJuror(
  persona: Persona,
  article: Article,
  settings: Settings,
  provider: LLMProvider,
): Promise<JurorResult> {
  const result = await callWithRetry<JurorOutput>({
    provider,
    config: settings.juror,
    model: settings.models.juror,
    system: buildJurorSystem(persona, article.genre),
    user: buildJurorUser(article, settings),
    jsonSchema: apiSchema("juror_output"),
    meta: { role: "juror", juror_code: persona.code, juror_name: persona.name, focus: persona.focus },
    parse: (text) => parseJurorOutput(text, settings),
  });
  return { ...result, jurorCode: persona.code, personaVersion: persona.version };
}

/** 給法官看的陪審員資料：只含成功的陪審員，附上職業與組別，依編號排序。 */
export function buildJuryPayload(results: JurorResult[], personaByCode: Record<string, Persona>): JuryPayloadItem[] {
  return [...results]
    .sort((a, b) => (a.jurorCode < b.jurorCode ? -1 : 1))
    .flatMap((r) =>
      r.status === "ok" && r.output
        ? [{ code: r.jurorCode, occupation: personaByCode[r.jurorCode].name, group: personaByCode[r.jurorCode].group, ...r.output }]
        : [],
    );
}

export async function runJudge(
  article: Article,
  juryPayload: JuryPayloadItem[],
  stats: SessionStats,
  settings: Settings,
  provider: LLMProvider,
): Promise<CallResult<JudgeOutput>> {
  const juryGroups = Object.fromEntries(juryPayload.map((item) => [item.code, item.group]));
  const { system, user } = buildJudgePrompts(article, juryPayload, stats, settings);
  return callWithRetry<JudgeOutput>({
    provider,
    config: settings.judge,
    model: settings.models.judge,
    system,
    user,
    jsonSchema: apiSchema("judge_output"),
    meta: {
      role: "judge",
      jury: juryPayload.map(({ code, occupation, group }) => ({ code, occupation, group })),
    },
    parse: (text) => parseJudgeOutput(text, settings, juryGroups),
  });
}

export async function runAdvice(
  article: Article,
  verdict: JudgeOutput,
  juryPayload: JuryPayloadItem[],
  settings: Settings,
  provider: LLMProvider,
): Promise<CallResult<AdviceOutput>> {
  const juryCodes = juryPayload.map((item) => item.code);
  const weaknesses = collectWeaknesses(juryPayload, settings.advice_output.max_weaknesses);
  const { system, user } = buildAdvicePrompts(article, verdict, weaknesses, settings);
  return callWithRetry<AdviceOutput>({
    provider,
    config: settings.advice,
    model: settings.models.advice,
    system,
    user,
    jsonSchema: adviceApiSchema(),
    meta: { role: "advice", article: article.content, jury_codes: juryCodes },
    parse: (text) => parseAdviceOutput(text, settings, article.content, juryCodes),
  });
}
