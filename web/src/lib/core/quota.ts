// 額度相關的純邏輯（PRD A-3、A-4、A-5）。
//
// 真正的把關在資料庫的 create_submission 函式裡（同一個交易內檢查並建立投稿，
// 防止同時送出多次超額）；這裡提供：
// 1. 送出請求的格式檢查（伺服器端一定會再檢查一次，不只靠前端）
// 2. 資料庫回傳的拒絕原因 → 給使用者看的白話訊息
// 3. 「今天」在指定時區的起點，供顯示與測試使用
import { z } from "zod";
import type { Settings } from "./shared";
import { checkSubmission, countChars } from "./text";

export const TITLE_MAX = 60;

export function submissionRequestSchema(settings: Settings) {
  const modules = settings.web.modules as [string, ...string[]];
  return z.strictObject({
    genre: z.string(),
    title: z.string().trim().max(TITLE_MAX).optional().default(""),
    content: z.string(),
    modules: z
      .array(z.enum(modules))
      .min(1)
      .refine((items) => new Set(items).size === items.length),
    // 自己選的陪審員（可選）；編號與每組名額由 jury.ts 的 validatePicks 檢查
    jury: z.array(z.string()).max(50).optional(),
  });
}

export type SubmissionRequest = z.infer<ReturnType<typeof submissionRequestSchema>>;

export type ValidatedSubmission =
  | { ok: true; value: { genre: string; title: string; content: string; modules: string[]; charCount: number } }
  | { ok: false; message: string };

/** 伺服器端檢查投稿內容。回傳可直接顯示給使用者的訊息。 */
export function validateSubmission(body: unknown, settings: Settings): ValidatedSubmission {
  const parsed = submissionRequestSchema(settings).safeParse(body);
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")));
    if (fields.has("modules")) return { ok: false, message: "請至少勾選一個回饋模組再送出。" };
    if (fields.has("title")) return { ok: false, message: `標題最多 ${TITLE_MAX} 字，請縮短後再試。` };
    return { ok: false, message: "送出的資料不完整，請重新整理頁面後再試一次。" };
  }
  const { genre, title, content, modules } = parsed.data;
  const problems = checkSubmission(genre, content, settings);
  if (problems.length > 0) return { ok: false, message: problems.join("\n") };
  return { ok: true, value: { genre, title, content, modules, charCount: countChars(content) } };
}

/** 資料庫 create_submission 可能回傳的拒絕原因。 */
export type RejectReason =
  | "terms_required"
  | "in_progress"
  | "quota_exceeded"
  | "global_full"
  | "rate_limited"
  | "budget_paused";

/** 拒絕原因 → 白話訊息（說明下一步，不顯示技術錯誤碼）。 */
export function rejectMessage(reason: string): string {
  switch (reason as RejectReason) {
    case "terms_required":
      return "請先閱讀並同意使用條款，再開始投稿。";
    case "in_progress":
      return "你有一篇作品正在開庭中，等它結束後再投下一篇。";
    case "quota_exceeded":
      return "今日次數已用完，明天 00:00（台北時間）重置。";
    case "global_full":
      return "今日法院已滿庭，請明天再來。";
    case "rate_limited":
      return "送出得太頻繁了，請等一分鐘後再試。";
    case "budget_paused":
      return "本月的 AI 費用已達上限，法院暫停收件，下個月 1 日恢復。";
    default:
      return "目前無法送出，請稍後再試一次。";
  }
}

export interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  globalUsed: number;
  globalLimit: number;
  inProgress: boolean;
}

/** 依額度狀態判斷現在能不能送出；不能時回傳原因。順序與資料庫函式一致。 */
export function quotaBlockReason(status: QuotaStatus): RejectReason | null {
  if (status.inProgress) return "in_progress";
  if (status.used >= status.limit) return "quota_exceeded";
  if (status.globalUsed >= status.globalLimit) return "global_full";
  return null;
}

/** 指定時區「今天 00:00」對應的 UTC 時間。額度以這個時間點重置。 */
export function dayStartUtc(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const localMidnightAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"));
  return new Date(localMidnightAsUtc - offsetMs);
}
