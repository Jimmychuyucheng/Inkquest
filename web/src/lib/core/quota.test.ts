// 額度檢查的測試（CLAUDE.md 規定一定要有）。
// 這裡測的是伺服器端的檢查邏輯與訊息；資料庫函式的實測在 scripts/test-db.mjs。
import { describe, expect, it } from "vitest";
import { dayStartUtc, quotaBlockReason, rejectMessage, validateSubmission, type QuotaStatus } from "./quota";
import { settings } from "./shared";

const status = (changes: Partial<QuotaStatus> = {}): QuotaStatus => ({
  used: 0,
  limit: 3,
  remaining: 3,
  globalUsed: 0,
  globalLimit: 25,
  inProgress: false,
  ...changes,
});

describe("額度判斷", () => {
  it("還有次數時可以送出", () => {
    expect(quotaBlockReason(status())).toBeNull();
    expect(quotaBlockReason(status({ used: 2 }))).toBeNull();
  });

  it("用完 3 次後，第 4 次被擋", () => {
    expect(quotaBlockReason(status({ used: 3, remaining: 0 }))).toBe("quota_exceeded");
    expect(rejectMessage("quota_exceeded")).toBe("今日次數已用完，明天 00:00（台北時間）重置。");
  });

  it("個別使用者的額度可以不同", () => {
    expect(quotaBlockReason(status({ used: 3, limit: 10 }))).toBeNull();
    expect(quotaBlockReason(status({ used: 0, limit: 0 }))).toBe("quota_exceeded");
  });

  it("全站達上限時所有人暫停送出", () => {
    expect(quotaBlockReason(status({ globalUsed: 25 }))).toBe("global_full");
    expect(rejectMessage("global_full")).toContain("今日法院已滿庭");
  });

  it("同時只能有一筆處理中的投稿", () => {
    expect(quotaBlockReason(status({ inProgress: true }))).toBe("in_progress");
  });

  it("訊息都是白話中文，不顯示錯誤碼", () => {
    for (const reason of ["terms_required", "in_progress", "quota_exceeded", "global_full", "rate_limited", "???"]) {
      const message = rejectMessage(reason);
      expect(message).toMatch(/[一-鿿]/);
      expect(message).not.toMatch(/[a-z]+_[a-z]+/);
    }
  });
});

describe("每日重置時間（台北時間 00:00）", () => {
  it("台北是 UTC+8，所以當天起點是前一天 16:00 UTC", () => {
    expect(dayStartUtc(new Date("2026-11-10T05:00:00Z"), "Asia/Taipei").toISOString()).toBe(
      "2026-11-09T16:00:00.000Z",
    );
    // 台北時間 11/10 23:59 仍屬於 11/10
    expect(dayStartUtc(new Date("2026-11-10T15:59:59Z"), "Asia/Taipei").toISOString()).toBe(
      "2026-11-09T16:00:00.000Z",
    );
    // 台北時間 11/11 00:00 換日
    expect(dayStartUtc(new Date("2026-11-10T16:00:00Z"), "Asia/Taipei").toISOString()).toBe(
      "2026-11-10T16:00:00.000Z",
    );
  });
});

describe("伺服器端檢查投稿內容", () => {
  const body = (changes: Record<string, unknown> = {}) => ({
    genre: "散文",
    title: "晾衣竿",
    content: "字".repeat(400),
    modules: ["verdict"],
    ...changes,
  });

  it("合格的投稿通過，並算出字數", () => {
    const result = validateSubmission(body(), settings);
    expect(result).toEqual({
      ok: true,
      value: { genre: "散文", title: "晾衣竿", content: "字".repeat(400), modules: ["verdict"], charCount: 400 },
    });
  });

  it("標題可以不填", () => {
    const rest: Record<string, unknown> = body();
    delete rest.title;
    const result = validateSubmission(rest, settings);
    expect(result.ok && result.value.title).toBe("");
  });

  it("字數不符、文類不對時被拒絕並說明", () => {
    const short = validateSubmission(body({ content: "太短" }), settings);
    expect(short).toEqual({ ok: false, message: "散文至少需要 300 字，目前是 2 字，請再多寫一些。" });
    const long = validateSubmission(body({ content: "字".repeat(5001) }), settings);
    expect(!long.ok && long.message).toContain("最多 5000 字");
    const genre = validateSubmission(body({ genre: "小說" }), settings);
    expect(!genre.ok && genre.message).toContain("沒有「小說」這個文類");
  });

  it("模組至少一個、只能是規定的四種", () => {
    expect(validateSubmission(body({ modules: [] }), settings)).toEqual({
      ok: false,
      message: "請至少勾選一個回饋模組再送出。",
    });
    expect(validateSubmission(body({ modules: ["verdict", "hack"] }), settings).ok).toBe(false);
    expect(validateSubmission(body({ modules: ["verdict", "verdict"] }), settings).ok).toBe(false);
    expect(validateSubmission(body({ modules: ["verdict", "jurors", "scores", "advice"] }), settings).ok).toBe(true);
  });

  it("多餘的欄位（例如想自己指定 user_id 或狀態）被拒絕", () => {
    expect(validateSubmission(body({ user_id: "別人的 id" }), settings).ok).toBe(false);
    expect(validateSubmission(body({ status: "done" }), settings).ok).toBe(false);
    expect(validateSubmission(null, settings).ok).toBe(false);
    expect(validateSubmission("字串", settings).ok).toBe(false);
  });

  it("新詩的換行原樣保留", () => {
    const poem = "雨停了\n\n　　窗台上\n一隻麻雀在等\n另一隻麻雀回來\n\n我也在等";
    const result = validateSubmission(body({ genre: "新詩", content: poem }), settings);
    expect(result.ok && result.value.content).toBe(poem);
  });
});
