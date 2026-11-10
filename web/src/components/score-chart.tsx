"use client";
// 分數分布長條圖（PRD 第 7 節）。0～10 分各有幾位陪審員。
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { copy } from "@/lib/copy";

export function ScoreChart({ distribution }: { distribution: Record<string, number> }) {
  const data = Array.from({ length: 11 }, (_, score) => ({ score: String(score), count: distribution[String(score)] ?? 0 }));
  const max = Math.max(1, ...data.map((d) => d.count));
  const summary = data
    .filter((d) => d.count > 0)
    .map((d) => copy.result.distributionAxis(Number(d.score), d.count))
    .join("、");
  return (
    <figure>
      {/* 圖表給看得見的人；同樣的資訊用文字提供給螢幕閱讀器 */}
      <div className="h-44 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="score" tickLine={false} axisLine={{ stroke: "var(--border)" }} fontSize={12} />
            <YAxis allowDecimals={false} domain={[0, max]} tickLine={false} axisLine={false} fontSize={12} />
            <Bar dataKey="count" fill="var(--primary)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        {copy.result.distribution}：{summary}
      </figcaption>
    </figure>
  );
}
