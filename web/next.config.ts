import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 這個專案的頁面幾乎都要讀登入狀態，所以不啟用 Cache Components 與部分預取，
  // 採用單純的「每次請求在伺服器算出頁面」，行為比較好預期。
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
