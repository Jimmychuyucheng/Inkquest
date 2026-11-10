// 模型供應商的設定檢查。不 import SDK，讓伺服器啟動檢查（instrumentation）可以單獨使用。
import type { Settings } from "@/lib/core/shared";

type Env = Record<string, string | undefined>;

export function resolveProviderName(settings: Settings, env: Env = process.env): string {
  return (env.LLM_PROVIDER ?? "").trim() || settings.default_provider;
}

/**
 * 正式環境不可以用假資料模式（PRD 第 9 節）：使用者會拿到假的判決。
 * 伺服器啟動時（src/instrumentation.ts）與每次取得 provider 時都會檢查。
 */
export function assertProviderAllowed(settings: Settings, env: Env = process.env): void {
  const name = resolveProviderName(settings, env);
  if (name !== "anthropic" && name !== "mock") {
    throw new Error(`不認得的 LLM_PROVIDER「${name}」，請改成 anthropic 或 mock。`);
  }
  if (name === "mock" && env.NODE_ENV === "production") {
    throw new Error("正式環境不可以使用假資料模式（LLM_PROVIDER=mock）。請改成 anthropic 並設定 ANTHROPIC_API_KEY。");
  }
}
