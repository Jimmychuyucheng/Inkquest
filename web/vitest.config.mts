import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    // 自動化測試一律使用假資料模式，不得呼叫真實 API
    env: { LLM_PROVIDER: "mock" },
  },
});
