// 假資料模式（LLM_PROVIDER=mock）：不呼叫任何模型，回傳符合 PRD 第 5 節 schema 的假資料。
// 自動化測試與畫面開發一律用這個。內容與 research/court/llm.py 的 mock 對應。
import { TAGS } from "@/lib/core/schemas";
import { LLMCallError, type LLMProvider, type LLMRequest, type LLMResponse } from "./types";

type Meta = Record<string, unknown>;
interface JuryMember {
  code: string;
  occupation: string;
  group: string;
}

/** 依陪審員編號產生固定、但每位不同的假評閱。 */
export function mockJurorOutput(meta: Meta) {
  const code = String(meta.juror_code ?? "J00");
  const name = String(meta.juror_name ?? "陪審員");
  const focus = String(meta.focus ?? "整體表現");
  const number = Number.parseInt(code.slice(1), 10) || 0;
  const score = 4 + (number % 5); // 4～8 分，讓不同陪審員有不同分數
  return {
    characters_in_text: ["我"],
    score,
    would_support_award: score >= 7,
    one_line: `（假資料）${name}：有亮點，也有可再磨之處。`,
    comment:
      `（假資料）我是${name}，編號 ${code}。我讀這篇作品時最在意的是${focus}。` +
      "整體來說，文章的開頭能把人帶進場景，中段的細節也算扎實，" +
      "讀得出作者確實花了心思觀察；不過結尾收得有點急，" +
      "幾個本來可以多停留一下的地方被輕輕帶過，力道因此弱了一些。" +
      "如果能把最想說的那件事再往前推一步，這篇會更完整，也更讓人記得住。",
    strengths: [{ point: `${name}認為開頭的場景描寫具體`, quote: "" }],
    weaknesses: [{ point: `${name}認為結尾收得太快`, quote: "" }],
    tags: [TAGS[number % TAGS.length], TAGS[(number + 5) % TAGS.length]],
  };
}

/** 依本次陪審團名單產生假判決：每個組別各引用一位。 */
export function mockJudgeOutput(meta: Meta) {
  const jury = (meta.jury as JuryMember[] | undefined) ?? [];
  const firstByGroup = new Map<string, JuryMember>();
  for (const member of jury) if (!firstByGroup.has(member.group)) firstByGroup.set(member.group, member);
  const cited = [...firstByGroup.values()];
  const citations = cited
    .map((m) => `${m.code} ${m.occupation}（${m.group}）認為作品的開頭具體、結尾收得稍快`)
    .join("；");
  return {
    headline: "（假資料）有亮點的作品，結尾可再打磨。",
    verdict:
      "（假資料）本庭綜合陪審團的意見後認為，這篇作品的場景描寫具體，能把讀者帶進現場，" +
      `多數陪審員對開頭與中段的細節給予肯定。${citations}。` +
      "各組的看法大致一致：優點集中在觀察的細緻與敘述的節制，缺點則集中在結尾的處理。" +
      "幾位陪審員都提到，作品最想說的那件事在最後被輕輕帶過，力道因此弱了一些；" +
      "也有人認為這種收法保留了餘地，不算缺點。綜合來看，這是一篇完成度不錯、" +
      "但仍有修改空間的投稿，建議作者把結尾再往前推一步，讓前面累積的細節有地方落下。" +
      "以上判斷完全依據陪審團提出的意見與程式計算的統計，本庭沒有另外加入新的評價。",
    minority_opinion:
      "（假資料）少數陪審員認為結尾收得快並不是缺點，反而讓作品保持節制，" +
      "不把話說滿；如果照多數意見把結尾寫得更完整，可能會失去原本安靜的力量。" +
      "這個看法值得作者在修改時一併考慮，不必急著把每個地方都交代清楚。",
    minority_jurors: cited.length > 0 ? [cited[cited.length - 1].code] : [],
    biggest_disagreement: "（假資料）結尾收得快，是缺點還是節制。",
    top_strengths: ["開頭的場景描寫具體"],
    top_weaknesses: ["結尾收得太快"],
    author_wellbeing_flag: false,
  };
}

/** 假的修改建議：引句取自文章的前幾個段落（一定是原文）。 */
export function mockAdviceOutput(meta: Meta) {
  const article = String(meta.article ?? "");
  const codes = (meta.jury_codes as string[] | undefined) ?? [];
  const lines = article
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const quotes = (lines.length >= 3 ? lines : [article.trim(), article.trim(), article.trim()])
    .slice(0, 3)
    .map((line) => line.slice(0, 20));
  return {
    suggestions: quotes.map((quote, index) => ({
      quote,
      issue: `（假資料）第 ${index + 1} 條：這裡交代得比較快，讀者還來不及看清楚畫面。`,
      direction: "（假資料）可以多停留一句，補上一個看得見的細節，再往下走。",
      example: index === 0 ? "（假資料）示範：把最想說的那件事，換成一個動作寫出來。" : "",
      raised_by: codes.slice(index, index + 2),
    })),
  };
}

export interface MockOptions {
  minDelaySeconds?: number;
  maxDelaySeconds?: number;
  failureRate?: number;
  /** 指定每次呼叫的回應：字串直接當作模型輸出、物件轉成 JSON、Error 則那一次丟出。用完後回到預設假資料。 */
  script?: unknown[];
  /** 指定哪些陪審員一律失敗（測試「部分陪審員失敗」用）。 */
  failJurors?: string[];
  random?: () => number;
}

export class MockProvider implements LLMProvider {
  readonly name = "mock" as const;
  readonly requests: LLMRequest[] = [];
  private readonly script: unknown[];
  private readonly failJurors: Set<string>;
  private readonly random: () => number;

  constructor(private readonly options: MockOptions = {}) {
    this.script = [...(options.script ?? [])];
    this.failJurors = new Set(options.failJurors ?? []);
    this.random = options.random ?? Math.random;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.requests.push(request);
    const min = this.options.minDelaySeconds ?? 0;
    const max = this.options.maxDelaySeconds ?? 0;
    const delayMs = Math.round((min + (max - min) * this.random()) * 1000);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (this.failJurors.has(String(request.meta.juror_code))) {
      throw new LLMCallError("（假資料模式）指定這位陪審員失敗", { retryable: false });
    }

    let text: string;
    if (this.script.length > 0) {
      const item = this.script.shift();
      if (item instanceof Error) throw item;
      text = typeof item === "string" ? item : JSON.stringify(item);
    } else {
      if (this.random() < (this.options.failureRate ?? 0)) {
        throw new LLMCallError("（假資料模式）模擬的偶發失敗");
      }
      const role = request.meta.role;
      const output =
        role === "judge"
          ? mockJudgeOutput(request.meta)
          : role === "advice"
            ? mockAdviceOutput(request.meta)
            : mockJurorOutput(request.meta);
      text = JSON.stringify(output);
    }
    return { text, model: "mock", inputTokens: 0, outputTokens: 0, latencyMs: delayMs, stopReason: "end_turn" };
  }
}
