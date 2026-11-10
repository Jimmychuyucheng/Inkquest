// 資料庫整合測試（npm run test:db 的第二段）：用真實的 Supabase，但模型一律是假資料。
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.dbtest.ts"],
    setupFiles: ["./scripts/vitest-db-setup.mjs"],
    env: { LLM_PROVIDER: "mock" },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
