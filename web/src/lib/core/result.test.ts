import { describe, expect, it } from "vitest";
import { formatDateTime, formatRatio, formatScore, groupColor, moduleView, splitByJurorCodes, verdictCopyText } from "./result";

describe("模組顯示規則", () => {
  it("只勾法官總評：其他不顯示，三個都可以補勾", () => {
    expect(moduleView(["verdict"])).toEqual({
      verdict: true, jurorsOpen: false, scores: false, advice: false, addable: ["jurors", "scores", "advice"],
    });
  });

  it("全勾：都顯示，沒有可以補的", () => {
    expect(moduleView(["verdict", "jurors", "scores", "advice"])).toEqual({
      verdict: true, jurorsOpen: true, scores: true, advice: true, addable: [],
    });
  });

  it("法官總評永遠顯示，即使沒有勾", () => {
    const view = moduleView(["scores"]);
    expect(view.verdict).toBe(true);
    expect(view.addable).toEqual(["jurors", "advice"]);
  });
});

describe("判決書裡的陪審員編號", () => {
  it("本次陪審團的編號切成可點擊的片段", () => {
    expect(splitByJurorCodes("J01 詩人說好；J13 也是。", ["J01", "J13"])).toEqual([
      { type: "juror", code: "J01" },
      { type: "text", text: " 詩人說好；" },
      { type: "juror", code: "J13" },
      { type: "text", text: " 也是。" },
    ]);
  });

  it("不在陪審團內的編號照原樣顯示；連續的編號各自成為連結", () => {
    expect(splitByJurorCodes("J01、J20 都提到", ["J01"])).toEqual([
      { type: "juror", code: "J01" },
      { type: "text", text: "、J20 都提到" },
    ]);
    expect(splitByJurorCodes("J16、J19認為", ["J16", "J19"]).filter((s) => s.type === "juror")).toHaveLength(2);
    expect(splitByJurorCodes("沒有編號", ["J01"])).toEqual([{ type: "text", text: "沒有編號" }]);
    expect(splitByJurorCodes("", ["J01"])).toEqual([]);
  });

  it("切開再接回去等於原文", () => {
    const text = "文學專業組：J02 小說家認為好；J05 則否。J99 不存在。";
    const joined = splitByJurorCodes(text, ["J02", "J05"]).map((s) => (s.type === "text" ? s.text : s.code)).join("");
    expect(joined).toBe(text);
  });
});

describe("顯示格式", () => {
  it("組別識別色", () => {
    expect([groupColor("文學專業"), groupColor("一般讀者"), groupColor("跨界視角")]).toEqual(["pro", "lay", "cross"]);
  });

  it("日期以台北時間顯示", () => {
    expect(formatDateTime("2026-11-10T15:56:12Z", "Asia/Taipei")).toBe("2026/11/10 23:56");
    expect(formatDateTime("2026-11-10T16:30:00Z", "Asia/Taipei")).toBe("2026/11/11 00:30");
  });

  it("分數與比例", () => {
    expect(formatScore(7)).toBe("7.0");
    expect(formatScore(6.7)).toBe("6.7");
    expect(formatScore(null)).toBe("—");
    expect(formatRatio(0.7)).toBe("70%");
    expect(formatRatio(0.33)).toBe("33%");
  });

  it("複製的法官總評包含標題、判決、少數意見與免責聲明", () => {
    const text = verdictCopyText(
      "",
      { headline: "細節紮實", verdict: "判決內容", minority_opinion: "少數意見", biggest_disagreement: "分歧點" },
      "本回饋由 AI 模擬",
    );
    expect(text.split("\n")[0]).toBe("《未命名》");
    for (const part of ["細節紮實", "判決內容", "少數意見", "分歧點", "本回饋由 AI 模擬"]) expect(text).toContain(part);
  });
});
