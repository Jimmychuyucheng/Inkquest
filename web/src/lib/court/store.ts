// CourtStore 的 Supabase 實作。使用 service role 連線，只能在背景工作中使用。
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdviceOutput, JudgeOutput, JurorOutput } from "@/lib/core/schemas";
import type { CourtStore, SubmissionPatch, SubmissionRecord } from "./pipeline";
import type { CallResult, JurorResult } from "./run";

function must<T>(result: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  // 只記錄錯誤代碼，不記錄內容（可能含文章）
  if (result.error) throw new Error(`${what}失敗（${result.error.code ?? "unknown"}）`);
  return result.data;
}

interface JurorRow {
  juror_code: string;
  persona_version: number;
  status: "ok" | "failed";
  output: JurorOutput | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  attempts: number;
  attempt_errors: string[];
}

export function createSupabaseStore(admin: SupabaseClient): CourtStore {
  return {
    async getSubmission(id) {
      const row = must(
        await admin.from("submissions").select("id, genre, title, content, modules, status, jury").eq("id", id).maybeSingle(),
        "讀取投稿",
      );
      return row as SubmissionRecord | null;
    },

    async updateSubmission(id, patch: SubmissionPatch) {
      must(await admin.from("submissions").update(patch).eq("id", id), "更新投稿");
    },

    async getJurorResults(id) {
      const rows = must(
        await admin
          .from("juror_results")
          .select("juror_code, persona_version, status, output, model, input_tokens, output_tokens, latency_ms, attempts, attempt_errors")
          .eq("submission_id", id)
          .order("juror_code"),
        "讀取陪審員結果",
      ) as JurorRow[];
      return rows.map(
        (row): JurorResult => ({
          jurorCode: row.juror_code,
          personaVersion: row.persona_version,
          status: row.status,
          output: row.output,
          model: row.model,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          latencyMs: row.latency_ms,
          attempts: row.attempts,
          error: row.status === "ok" ? null : (row.attempt_errors.at(-1) ?? null),
          attemptErrors: row.attempt_errors,
        }),
      );
    },

    async saveJurorResult(id, result) {
      must(
        await admin.from("juror_results").upsert(
          {
            submission_id: id,
            juror_code: result.jurorCode,
            persona_version: result.personaVersion,
            status: result.status,
            output: result.output,
            model: result.model,
            input_tokens: result.inputTokens,
            output_tokens: result.outputTokens,
            latency_ms: result.latencyMs,
            attempts: result.attempts,
            attempt_errors: result.attemptErrors,
          },
          { onConflict: "submission_id,juror_code" },
        ),
        "寫入陪審員結果",
      );
    },

    async getVerdict(id) {
      const row = must(await admin.from("verdicts").select("output").eq("submission_id", id).maybeSingle(), "讀取判決");
      return (row?.output as JudgeOutput | undefined) ?? null;
    },

    async saveVerdict(id, result: CallResult<JudgeOutput>) {
      must(
        await admin.from("verdicts").upsert({
          submission_id: id,
          output: result.output,
          model: result.model,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          attempts: result.attempts,
          attempt_errors: result.attemptErrors,
        }),
        "寫入判決",
      );
    },

    async hasAdvice(id) {
      const row = must(await admin.from("advice").select("submission_id").eq("submission_id", id).maybeSingle(), "讀取修改建議");
      return row !== null;
    },

    async saveAdvice(id, result: CallResult<AdviceOutput>) {
      must(
        await admin.from("advice").upsert({
          submission_id: id,
          output: result.output,
          model: result.model,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          attempts: result.attempts,
          attempt_errors: result.attemptErrors,
        }),
        "寫入修改建議",
      );
    },
  };
}
