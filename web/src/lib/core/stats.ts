// 計分與得獎潛力（PRD 第 6 節）。所有數字由程式計算，不讓模型自己報數字。
// 與 research/court/stats.py 的結果必須一致（由 shared/fixtures/parity.json 驗證）。
import type { Group, Settings } from "./shared";

export interface JurorScore {
  code: string;
  group: Group;
  score: number;
  would_support_award: boolean;
  tags: string[];
}

export interface SessionStats {
  juror_count: number;
  mean_score: number;
  support_count: number;
  support_ratio: number;
  potential_label: string;
  group_means: Record<string, number | null>;
  distribution: Record<string, number>;
  score_std: number;
  controversy: "高" | "中" | "低";
  top_tags: string[];
}

/**
 * 四捨五入（遇 5 進位）。用整數運算，避免 6.25 這類數字因浮點誤差算錯。
 * numerator / denominator 取到小數 digits 位。
 */
export function roundHalfUp(numerator: number, denominator: number, digits: number): number {
  const scale = 10 ** digits;
  // floor((2 * n * scale + d) / (2 * d)) 等於「n / d * scale」四捨五入
  const scaled = Math.floor((2 * numerator * scale + denominator) / (2 * denominator));
  return scaled / scale;
}

function populationStd(values: number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * jurors：成功評閱的陪審員。allGroups：所有組別（決定 group_means 的 key 與順序）。
 */
export function computeStats(
  jurors: JurorScore[],
  allGroups: readonly string[],
  config: Settings["stats"],
): SessionStats {
  if (jurors.length === 0) {
    throw new Error("沒有成功的陪審員，無法計算統計");
  }
  const sorted = [...jurors].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const scores = sorted.map((j) => j.score);
  const total = scores.reduce((sum, v) => sum + v, 0);
  const supportCount = sorted.filter((j) => j.would_support_award).length;
  const ratio = supportCount / sorted.length;
  const std = populationStd(scores);

  const groupMeans: Record<string, number | null> = {};
  for (const group of allGroups) {
    const groupScores = sorted.filter((j) => j.group === group).map((j) => j.score);
    groupMeans[group] =
      groupScores.length > 0
        ? roundHalfUp(groupScores.reduce((sum, v) => sum + v, 0), groupScores.length, 1)
        : null;
  }

  let controversy: SessionStats["controversy"];
  if (
    std >= config.controversy_high_std ||
    (ratio >= config.controversy_split_low && ratio < config.controversy_split_high)
  ) {
    controversy = "高";
  } else if (std >= config.controversy_mid_std) {
    controversy = "中";
  } else {
    controversy = "低";
  }

  const labels = [...config.potential_labels].sort((a, b) => b.min - a.min);
  const potential = (labels.find((item) => ratio >= item.min) ?? labels[labels.length - 1]).label;

  // 依編號順序統計；次數相同時先出現的排前面，結果才會固定
  const tagCounts = new Map<string, number>();
  for (const juror of sorted) {
    for (const tag of juror.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()]
    .map(([tag, count], order) => ({ tag, count, order }))
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, config.top_tags)
    .map((item) => item.tag);

  const distribution: Record<string, number> = {};
  for (let score = 0; score <= 10; score += 1) {
    distribution[String(score)] = scores.filter((s) => s === score).length;
  }

  return {
    juror_count: sorted.length,
    mean_score: roundHalfUp(total, sorted.length, 1),
    support_count: supportCount,
    support_ratio: roundHalfUp(supportCount, sorted.length, 2),
    potential_label: potential,
    group_means: groupMeans,
    distribution,
    score_std: Math.round(std * 100) / 100,
    controversy,
    top_tags: topTags,
  };
}
