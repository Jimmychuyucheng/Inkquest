import { describe, expect, it } from "vitest";
import { formatDateTime, formatRatio, formatScore, groupColor, moduleView, splitByJurorCodes, verdictCopyText, readableSentence, splitSentences, verdictBoard, verdictMentions } from "./result";

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

// ---- 法官總評圖像化：從判決書擷取每位陪審員對應的句子 ----
// 測試資料取自 W0 真實模型的判決書（research/results/essay1、essay2、essay4）

describe("切句子", () => {
  it("在句號、問號、驚嘆號後切開", () => {
    expect(splitSentences("第一句。第二句？第三句！")).toEqual(["第一句。", "第二句？", "第三句！"]);
  });
  it("引號裡的句號不切", () => {
    expect(splitSentences("他說「先吃飯。再說。」然後走了。下一句。")).toEqual(["他說「先吃飯。再說。」然後走了。", "下一句。"]);
  });
  it("換行也是分界，沒有句號的結尾也保留", () => {
    expect(splitSentences("第一段\n第二段沒有句號")).toEqual(["第一段", "第二段沒有句號"]);
  });
});

describe("編號換成職業名稱", () => {
  const names: Record<string, string> = { J02: "小說家", J04: "文學研究者", J05: "國文老師", J11: "高中生", J14: "中小企業老闆" };
  const nameOf = (code: string) => names[code] ?? code;
  const jury = Object.keys(names);
  it("編號後面已經有名稱：拿掉編號", () => {
    expect(readableSentence("J02小說家認為很有重量。", jury, nameOf)).toBe("小說家認為很有重量。");
    expect(readableSentence("J02 小說家認為很有重量。", jury, nameOf)).toBe("小說家認為很有重量。");
  });
  it("名稱後面括號裡的編號：拿掉括號", () => {
    expect(readableSentence("小說家（J02）認為很有重量。", jury, nameOf)).toBe("小說家認為很有重量。");
  });
  it("只有編號：換成名稱", () => {
    expect(readableSentence("J05、J11皆指出段落重複。", jury, nameOf)).toBe("國文老師、高中生皆指出段落重複。");
    expect(readableSentence("J14認為收尾太急。", jury, nameOf)).toBe("中小企業老闆認為收尾太急。");
  });
  it("法官用職業名的簡稱：換成完整名稱，不重複", () => {
    expect(readableSentence("J14老闆則認為收得太快。", jury, nameOf)).toBe("中小企業老闆則認為收得太快。");
    expect(readableSentence("J14 老闆說。", jury, nameOf)).toBe("中小企業老闆說。");
  });
  it("後面只接一個字、碰巧是名稱最後一字時不當作簡稱", () => {
    expect(readableSentence("J14闆", jury, nameOf)).toBe("中小企業老闆闆");
  });
  it("拿掉組別註記", () => {
    expect(readableSentence("J04文學研究者（文學專業）指出，「快閃」一詞回扣標題。", jury, nameOf)).toBe("文學研究者指出，「快閃」一詞回扣標題。");
  });
  it("不在本次陪審團的編號照原樣保留", () => {
    expect(readableSentence("J99 也說了話。", jury, nameOf)).toBe("J99 也說了話。");
  });
});

describe("判決書提到的陪審員", () => {
  const names: Record<string, string> = {
    J02: "小說家", J05: "國文老師", J07: "記者", J09: "心理諮商師", J11: "高中生", J14: "中小企業老闆", J16: "農夫", J19: "急診護理師",
  };
  const nameOf = (code: string) => names[code] ?? code;
  const jury = ["J02", "J05", "J07", "J09", "J11", "J13", "J14", "J16", "J19", "J20"];
  const essay1 =
    "本篇以「年紀作為度量衡」貫穿全文，陪審團平均分數為7.9分，9位陪審員全數表示支持。J02小說家認為，高麗菜婆炒菜加花生米、白菜婆偷摘番石榴等具體動作很有重量，結尾擦拭冷燙機的收法也乾淨。J07記者從採訪角度肯定人事時地交代清楚，高麗菜婆的長女經歷有具體事件支撐，讀來不費力。J14老闆則認為菜菜子們有血有肉，但覺得「媽媽的臉龐也變得很亮」收得太快，情感來不及沉澱。J19急診護理師欣賞「好命論」的反諷與不喊情緒的收法，認為情感冷靜卻有餘溫。本篇在生死題材上的處理，也獲得陪審員普遍認可，被視為全文最有張力之處。";

  it("依第一次被提到的順序，列出每位陪審員與提到他的句子", () => {
    const mentions = verdictMentions(essay1, jury, nameOf);
    expect(mentions.map((m) => m.code)).toEqual(["J02", "J07", "J14", "J19"]);
    expect(mentions[0].sentences).toEqual([
      "小說家認為，高麗菜婆炒菜加花生米、白菜婆偷摘番石榴等具體動作很有重量，結尾擦拭冷燙機的收法也乾淨。",
    ]);
    // 法官寫的是簡稱「J14老闆」：換成完整名稱，不會變成「中小企業老闆老闆」
    expect(mentions[2].sentences[0]).toBe("中小企業老闆則認為菜菜子們有血有肉，但覺得「媽媽的臉龐也變得很亮」收得太快，情感來不及沉澱。");
  });

  it("沒有提到任何陪審員的句子不列入", () => {
    const all = verdictMentions(essay1, jury, nameOf).flatMap((m) => m.sentences);
    expect(all.some((s) => s.includes("平均分數"))).toBe(false);
    expect(all.some((s) => s.includes("生死題材"))).toBe(false);
  });

  it("同一段提到多位時，每一位都列出這段", () => {
    const mentions = verdictMentions("J05、J11、J16皆指出好命論段落重複、拖慢節奏。", jury, nameOf);
    expect(mentions.map((m) => m.code)).toEqual(["J05", "J11", "J16"]);
    for (const m of mentions) expect(m.sentences).toEqual(["國文老師、高中生、農夫皆指出好命論段落重複、拖慢節奏。"]);
  });

  it("用分號分別講不同人時，每位只拿到自己的那段（真實的少數意見書）", () => {
    const text =
      "全體陪審員皆表示支持，故無相反的多數意見。最大保留在於結尾與中段節奏：J14認為收尾太急，「媽媽的臉龐也變得很亮」像匆匆封箱；J05、J11、J16皆指出好命論段落重複、拖慢節奏；J09則認為人物一多，菜菜子的名字容易混淆，情緒收得過快。";
    const mentions = verdictMentions(text, jury, nameOf);
    expect(mentions.map((m) => m.code)).toEqual(["J14", "J05", "J11", "J16", "J09"]);
    expect(mentions[0].sentences).toEqual(["最大保留在於結尾與中段節奏：中小企業老闆認為收尾太急，「媽媽的臉龐也變得很亮」像匆匆封箱。"]);
    expect(mentions[1].sentences).toEqual(["國文老師、高中生、農夫皆指出好命論段落重複、拖慢節奏。"]);
    expect(mentions[4].sentences).toEqual(["心理諮商師則認為人物一多，菜菜子的名字容易混淆，情緒收得過快。"]);
  });

  it("分號後面沒有編號的子句接在前一位後面", () => {
    const mentions = verdictMentions("J02認為動作很有重量；但也覺得結尾稍快。", jury, nameOf);
    expect(mentions).toEqual([{ code: "J02", sentences: ["小說家認為動作很有重量；但也覺得結尾稍快。"] }]);
  });

  describe("總評看板的人選（文學專業 2、一般讀者 1、跨界視角 1）", () => {
    const groups: Record<string, string> = {
      J02: "文學專業", J05: "文學專業", J07: "一般讀者", J09: "一般讀者", J11: "一般讀者",
      J13: "跨界視角", J14: "跨界視角", J16: "跨界視角", J19: "跨界視角", J20: "跨界視角",
    };
    const quota = { 文學專業: 2, 一般讀者: 1, 跨界視角: 1 };
    const groupOf = (code: string) => groups[code];

    it("每組先放法官點名的人，不夠再補同組其他人（真實判決書）", () => {
      const board = verdictBoard(verdictMentions(essay1, jury, nameOf), jury, groupOf, quota, () => true);
      expect(board.map((b) => b.code)).toEqual(["J02", "J05", "J07", "J14"]);
      expect(board[1].sentences).toEqual([]); // J05 沒被點名，是補位
      expect(board[3].sentences[0]).toContain("中小企業老闆");
    });

    it("點名人數超過名額時，依點名順序取前面的", () => {
      const mentions = verdictMentions("J19說好。J14說不好。J13也說好。", jury, nameOf);
      const board = verdictBoard(mentions, jury, groupOf, quota, () => true);
      expect(board.filter((b) => groups[b.code] === "跨界視角").map((b) => b.code)).toEqual(["J19"]);
    });

    it("補位不放缺席的陪審員；整組都缺席時那組就少放", () => {
      const board = verdictBoard([], jury, groupOf, quota, (code) => code !== "J02");
      expect(board.map((b) => b.code)).toEqual(["J05", "J07", "J13"]);
    });
  });

  it("引號裡的分號不切", () => {
    const mentions = verdictMentions("J02引用「先吃飯；再說」這句。", jury, nameOf);
    expect(mentions[0].sentences).toEqual(["小說家引用「先吃飯；再說」這句。"]);
  });

  it("沒有提到任何人時回傳空陣列", () => {
    expect(verdictMentions("整體而言，陪審團肯定其結構。", jury, nameOf)).toEqual([]);
  });
});
