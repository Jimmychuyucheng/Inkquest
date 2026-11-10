// 組出陪審員、法官、修改建議的 prompt。模板來自 shared/prompts/（唯一來源）。
// 與 research/court/prompts.py、judge.py 的做法相同。
import { TAGS, type JudgeOutput, type JurorOutput } from "@/lib/core/schemas";
import { groupRules, layBannedTerms, prompts, type Persona, type Settings } from "@/lib/core/shared";
import type { SessionStats } from "@/lib/core/stats";

export const UNTITLED = "未命名";

/**
 * 一次性替換 {名稱}。只掃描模板本身一次，所以填進去的內容（例如文章）即使含有 {genre}
 * 之類的字樣，也不會被再次替換。模板中出現未提供的名稱會直接報錯。
 */
export function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`prompt 模板需要 {${key}}，但沒有提供`);
    return values[key];
  });
}

/** 把文章裡的 <article>、</article> 換成全形括號，避免文章提前結束待評區塊。 */
export function neutralizeArticleTags(text: string): string {
  return text.replace(/<\s*(\/?)\s*article\s*>/gi, (_, slash: string) => `＜${slash}article＞`);
}

const trimNewlines = (text: string) => text.replace(/^\n+|\n+$/g, "");

function template(name: string): string {
  const text = prompts[name];
  if (!text) throw new Error(`找不到 prompt 模板 ${name}`);
  return text;
}

export function groupRuleFor(persona: Persona): string {
  return render(groupRules[persona.group] ?? "", { banned_terms: layBannedTerms.join("、") });
}

interface Article {
  genre: string;
  title: string;
  content: string;
}

function articleValues(article: Article, settings: Settings): Record<string, string> {
  return {
    genre: article.genre,
    genre_description: settings.genres[article.genre].description,
    title: neutralizeArticleTags(article.title.trim()) || UNTITLED,
    // 保留原文的換行（新詩的分行是作品的一部分），只去掉頭尾的空行
    content: neutralizeArticleTags(trimNewlines(article.content)),
  };
}

export function buildJurorSystem(persona: Persona, genre: string): string {
  return render(template("juror_system"), {
    occupation: persona.name,
    background: persona.background,
    genre,
    focus: persona.focus,
    tone: persona.tone,
    voice_traits: persona.voice_traits,
    vocabulary_rule: persona.vocabulary_rule,
    group_rule: groupRuleFor(persona),
  });
}

export function buildJurorUser(article: Article, settings: Settings): string {
  const limits = settings.juror_output;
  return render(template("juror_user"), {
    ...articleValues(article, settings),
    one_line_max: String(limits.one_line_max),
    comment_min: String(limits.comment_min),
    comment_max: String(limits.comment_max),
    tags: TAGS.join("、"),
  });
}

export interface JuryPayloadItem extends JurorOutput {
  code: string;
  occupation: string;
  group: string;
}

export function buildJudgePrompts(
  article: Article,
  juryPayload: JuryPayloadItem[],
  stats: SessionStats,
  settings: Settings,
): { system: string; user: string } {
  const limits = settings.judge_output;
  const system = render(template("judge_system"), {
    genre: article.genre,
    min_cited_jurors: String(limits.min_cited_jurors),
    banned_words: limits.banned_words.map((word) => `「${word}」`).join("、"),
  });
  const user = render(template("judge_user"), {
    ...articleValues(article, settings),
    juror_count: String(juryPayload.length),
    // 陪審員的引句來自文章，同樣可能含有標記字樣，一併處理
    jury_json: neutralizeArticleTags(JSON.stringify(juryPayload, null, 1)),
    stats_json: JSON.stringify(stats, null, 1),
    headline_max: String(limits.headline_max),
    verdict_min: String(limits.verdict_min),
    verdict_max: String(limits.verdict_max),
    minority_min: String(limits.minority_min),
    minority_max: String(limits.minority_max),
    disagreement_max: String(limits.disagreement_max),
    min_cited_jurors: String(limits.min_cited_jurors),
  });
  return { system, user };
}

export interface WeaknessItem {
  point: string;
  quote: string;
  raised_by: string;
}

/** 整理陪審員提到的缺點給修改建議角色：依編號排序，輪流各取一條，最多 max 條。 */
export function collectWeaknesses(juryPayload: JuryPayloadItem[], max: number): WeaknessItem[] {
  const items: WeaknessItem[] = [];
  for (let round = 0; items.length < max; round += 1) {
    const picked = juryPayload.filter((juror) => juror.weaknesses[round] !== undefined);
    if (picked.length === 0) break;
    for (const juror of picked) {
      if (items.length >= max) break;
      items.push({ ...juror.weaknesses[round], raised_by: juror.code });
    }
  }
  return items;
}

export function buildAdvicePrompts(
  article: Article,
  verdict: JudgeOutput,
  weaknesses: WeaknessItem[],
  settings: Settings,
): { system: string; user: string } {
  const limits = { min_items: String(settings.advice_output.min_items), max_items: String(settings.advice_output.max_items) };
  const system = render(template("advice_system"), { genre: article.genre, ...limits });
  const user = render(template("advice_user"), {
    ...articleValues(article, settings),
    verdict_json: neutralizeArticleTags(JSON.stringify(verdict, null, 1)),
    weaknesses_json: neutralizeArticleTags(JSON.stringify(weaknesses, null, 1)),
    ...limits,
  });
  return { system, user };
}
