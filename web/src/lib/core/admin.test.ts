// 後台的純邏輯測試：費用估算、月費用警戒線、額度設定的格式檢查、匯出 CSV。
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAccountRows, settingsUpdateSchema, userQuotaSchema } from "./admin";
import { anonymousCode, buildCsv, EXPORT_COLUMNS, formatLocal, type ExportSubmission } from "./export";
import { rejectMessage } from "./quota";
import { settings } from "./shared";
import { budgetLevel, monthStartUtc, rowCost, summarizeUsage, usageSchema } from "./usage";

const pricing = {
  "claude-haiku-5-5": { input_per_mtok: 0.1, output_per_mtok: 0.5 },
  "claude-sonnet-5-5": { input_per_mtok: 2, output_per_mtok: 10 },
};

describe("費用估算", () => {
  it("依單價換算：每百萬 token 的價格", () => {
    expect(rowCost({ model: "claude-haiku-5-5", input_tokens: 1_000_000, output_tokens: 1_000_000 }, pricing)).toBeCloseTo(0.6);
    expect(rowCost({ model: "claude-sonnet-5-5", input_tokens: 13_712, output_tokens: 2_787 }, pricing)).toBeCloseTo(0.05529);
  });

  it("沒有單價的模型（mock）回傳 null", () => {
    expect(rowCost({ model: "mock", input_tokens: 5, output_tokens: 5 }, pricing)).toBeNull();
  });

  it("依來源加總，並列出沒有單價的模型", () => {
    const raw = usageSchema.parse({
      submissions: { done: 4, failed: 1, jurors_running: 1 },
      active_users: 3,
      tokens: [
        { source: "juror", model: "claude-haiku-5-5", calls: 40, input_tokens: "1000000", output_tokens: 200000 },
        { source: "judge", model: "claude-sonnet-5-5", calls: 4, input_tokens: 100000, output_tokens: 10000 },
        { source: "advice", model: "mock", calls: 2, input_tokens: 0, output_tokens: 0 },
      ],
    });
    const s = summarizeUsage(raw, pricing);
    expect(s.submissions).toEqual({ total: 6, done: 4, failed: 1, inProgress: 1 });
    expect(s.activeUsers).toBe(3);
    expect(s.bySource.juror.costUsd).toBeCloseTo(0.2);
    expect(s.bySource.judge.costUsd).toBeCloseTo(0.3);
    expect(s.bySource.advice).toEqual({ calls: 2, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(s.total.calls).toBe(46);
    expect(s.total.costUsd).toBeCloseTo(0.5);
    expect(s.unpricedModels).toEqual(["mock"]);
  });

  it("沒有任何紀錄時全部是 0", () => {
    const s = summarizeUsage(usageSchema.parse({ submissions: {}, active_users: 0, tokens: [] }), pricing);
    expect(s.total).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(s.submissions.total).toBe(0);
  });

  it("資料庫回傳的格式不對時拒絕", () => {
    expect(usageSchema.safeParse({ submissions: {}, active_users: 0, tokens: [{ source: "hack" }] }).success).toBe(false);
  });
});

describe("月費用警戒線", () => {
  const warn = settings.web.budget_warn_ratio;
  it("未達 80% 正常、達 80% 警示、達 100% 暫停", () => {
    expect(warn).toBe(0.8);
    expect(budgetLevel(9.59, 12, warn)).toBe("ok");
    expect(budgetLevel(9.6, 12, warn)).toBe("warn");
    expect(budgetLevel(11.99, 12, warn)).toBe("warn");
    expect(budgetLevel(12, 12, warn)).toBe("paused");
    expect(budgetLevel(15, 12, warn)).toBe("paused");
  });

  it("預算設為 0 時一律暫停", () => {
    expect(budgetLevel(0, 0, warn)).toBe("paused");
  });

  it("暫停時給使用者白話說明", () => {
    expect(rejectMessage("budget_paused")).toContain("下個月 1 日恢復");
  });
});

describe("本月起點（台北時間）", () => {
  it("月中", () => {
    expect(monthStartUtc(new Date("2026-11-11T05:00:00Z"), "Asia/Taipei").toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });
  it("台北已經是 12/1，但 UTC 還是 11/30", () => {
    expect(monthStartUtc(new Date("2026-11-30T17:00:00Z"), "Asia/Taipei").toISOString()).toBe("2026-11-30T16:00:00.000Z");
  });
  it("台北還是 11/30 深夜", () => {
    expect(monthStartUtc(new Date("2026-11-30T15:59:59Z"), "Asia/Taipei").toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });
  it("1 日剛過午夜", () => {
    expect(monthStartUtc(new Date("2026-10-31T16:00:00Z"), "Asia/Taipei").toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });
});

describe("額度設定的格式檢查", () => {
  it("接受 0 以上的整數，可以只改一項", () => {
    expect(settingsUpdateSchema.safeParse({ daily_quota_per_user: 5, global_daily_limit: 0 }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ global_daily_limit: 40 }).success).toBe(true);
  });

  it("拒絕負數、小數、文字、空物件與其他欄位", () => {
    for (const body of [
      { daily_quota_per_user: -1 },
      { daily_quota_per_user: 2.5 },
      { daily_quota_per_user: "5" },
      {},
      { monthly_budget_usd: 100 },
      { daily_quota_per_user: 3, role: "admin" },
      null,
    ]) {
      expect(settingsUpdateSchema.safeParse(body).success).toBe(false);
    }
  });

  it("個別額度：數字或 null（改回預設）", () => {
    expect(userQuotaSchema.safeParse({ daily_quota_override: 10 }).success).toBe(true);
    expect(userQuotaSchema.safeParse({ daily_quota_override: null }).success).toBe(true);
    expect(userQuotaSchema.safeParse({ daily_quota_override: -3 }).success).toBe(false);
    expect(userQuotaSchema.safeParse({}).success).toBe(false);
    expect(userQuotaSchema.safeParse({ daily_quota_override: 3, role: "admin" }).success).toBe(false);
  });
});

describe("匯出投稿統計 CSV", () => {
  const row = (changes: Partial<ExportSubmission> = {}): ExportSubmission => ({
    user_id: "6f1c1f0e-1111-4222-8333-444455556666",
    genre: "散文",
    char_count: 1520,
    modules: ["verdict", "scores"],
    status: "done",
    jurors_ok: 9,
    stats: { mean_score: 6.7, support_ratio: 0.6, group_means: { 文學專業: 6.3, 一般讀者: 7, 跨界視角: null }, controversy: "高" },
    created_at: "2026-11-11T05:03:04Z",
    finished_at: "2026-11-11T05:03:50Z",
    research_consent: true,
    juror_results: [
      { juror_code: "J03", status: "ok", score: 7 },
      { juror_code: "J11", status: "failed", score: null },
      { juror_code: "J20", status: "ok", score: 6 },
    ],
    ...changes,
  });

  const SALT = "test-salt-not-a-real-secret";
  const parse = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n").map((line) => line.split(","));

  it("開頭有 BOM，第一列是欄位名稱，含 20 位陪審員欄位", () => {
    const csv = buildCsv([row()], "Asia/Taipei", SALT);
    expect(csv.startsWith("﻿")).toBe(true);
    const [header] = parse(csv);
    expect(header).toEqual(EXPORT_COLUMNS);
    expect(header.filter((h) => /^J\d{2}$/.test(h))).toHaveLength(20);
    for (const name of ["user_code", "genre", "char_count", "modules", "status", "jurors_ok", "mean_score", "support_ratio", "controversy", "created_at", "finished_at", "research_consent"]) {
      expect(header).toContain(name);
    }
  });

  it("每筆投稿一列，數值、各組平均、陪審員分數放在對的欄位", () => {
    const [header, values] = parse(buildCsv([row()], "Asia/Taipei", SALT));
    const get = (name: string) => values[header.indexOf(name)];
    expect(get("genre")).toBe("散文");
    expect(get("char_count")).toBe("1520");
    expect(get("modules")).toBe("verdict|scores");
    expect(get("mean_score")).toBe("6.7");
    expect(get("support_ratio")).toBe("0.6");
    expect(get("group_mean_文學專業")).toBe("6.3");
    expect(get("group_mean_跨界視角")).toBe("");
    expect(get("controversy")).toBe("高");
    expect(get("J03")).toBe("7");
    expect(get("J20")).toBe("6");
    expect(get("J11")).toBe(""); // 失敗的陪審員不給分數
    expect(get("J01")).toBe(""); // 沒被抽中
    expect(get("created_at")).toBe("2026-11-11 13:03:04");
    expect(get("research_consent")).toBe("true");
  });

  it("失敗的投稿沒有統計，欄位留空", () => {
    const [header, values] = parse(buildCsv([row({ status: "failed", stats: null, finished_at: null, juror_results: [] })], "Asia/Taipei", SALT));
    expect(values[header.indexOf("mean_score")]).toBe("");
    expect(values[header.indexOf("finished_at")]).toBe("");
  });

  it("使用者以匿名代號表示：同一人相同、不同人不同、看不出原本的 id", () => {
    const a = anonymousCode("6f1c1f0e-1111-4222-8333-444455556666", SALT);
    expect(a).toMatch(/^U[0-9a-f]{10}$/);
    expect(anonymousCode("6f1c1f0e-1111-4222-8333-444455556666", SALT)).toBe(a);
    expect(anonymousCode("00000000-0000-4000-8000-000000000000", SALT)).not.toBe(a);
    const csv = buildCsv([row()], "Asia/Taipei", SALT);
    expect(csv).not.toContain("6f1c1f0e");
    expect(csv).toContain(a);
  });

  it("代號依密鑰而定：沒有密鑰算不出來，不同密鑰得到不同代號", () => {
    const id = "6f1c1f0e-1111-4222-8333-444455556666";
    expect(anonymousCode(id, "another-salt")).not.toBe(anonymousCode(id, SALT));
    // 不是單純的 sha256(user id)：拿到 user id 的人無法自己算出代號
    const plain = `U${createHash("sha256").update(id).digest("hex").slice(0, 10)}`;
    expect(anonymousCode(id, SALT)).not.toBe(plain);
    expect(() => anonymousCode(id, "")).toThrow();
  });

  it("不含文章內容、標題與 email，即使資料裡混進了這些欄位", () => {
    const leaky = { ...row(), content: "外婆家的晾衣竿", title: "秘密標題", email: "someone@example.com" } as ExportSubmission;
    const csv = buildCsv([leaky], "Asia/Taipei", SALT);
    expect(csv).not.toContain("晾衣竿");
    expect(csv).not.toContain("秘密標題");
    expect(csv).not.toContain("@example.com");
  });

  it("含逗號或引號的值會加上引號", () => {
    const csv = buildCsv([row({ genre: '散,文"' })], "Asia/Taipei", SALT);
    expect(csv).toContain('"散,文"""');
  });

  it("沒有資料時只有欄位名稱", () => {
    expect(parse(buildCsv([], "Asia/Taipei", SALT))).toHaveLength(1);
  });

  it("時間轉成台北時間", () => {
    expect(formatLocal("2026-11-30T17:00:00Z", "Asia/Taipei")).toBe("2026-12-01 01:00:00");
    expect(formatLocal(null, "Asia/Taipei")).toBe("");
  });
});

describe("後台註冊帳號列表", () => {
  const base = { display_name: null, role: "user", daily_quota_override: null, research_consent_at: null };
  const profiles = [
    { ...base, id: "a", email: "a@example.com", created_at: "2026-11-10T01:00:00Z" },
    { ...base, id: "b", email: "b@example.com", created_at: "2026-11-12T01:00:00Z", display_name: "小B", role: "admin", daily_quota_override: 100, research_consent_at: "2026-11-12T01:05:00Z" },
  ];

  it("依註冊時間由新到舊，並合併登入時間與投稿數", () => {
    const rows = buildAccountRows(profiles, { b: "2026-11-12T03:00:00Z" }, ["a", "b", "a"]);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(rows[0]).toMatchObject({ name: "小B", isAdmin: true, lastSignInAt: "2026-11-12T03:00:00Z", submissions: 1, researchConsent: true, quotaOverride: 100 });
    expect(rows[1]).toMatchObject({ name: "", isAdmin: false, lastSignInAt: null, submissions: 2, researchConsent: false, quotaOverride: null });
  });

  it("沒有投稿的帳號投稿數為 0", () => {
    expect(buildAccountRows(profiles, {}, []).every((r) => r.submissions === 0)).toBe(true);
  });
});
