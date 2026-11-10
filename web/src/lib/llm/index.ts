// 依設定選擇模型供應商。環境變數 LLM_PROVIDER 會覆蓋 shared/settings.yaml 的 default_provider。
import type { Settings } from "@/lib/core/shared";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import { assertProviderAllowed, resolveProviderName } from "./check";
import type { LLMProvider } from "./types";

export * from "./types";
export { AnthropicProvider } from "./anthropic";
export { MockProvider } from "./mock";
export { assertProviderAllowed, resolveProviderName } from "./check";

let announced = false;

export function getProvider(settings: Settings, env: Record<string, string | undefined> = process.env): LLMProvider {
  assertProviderAllowed(settings, env);
  if (resolveProviderName(settings, env) === "mock") {
    return new MockProvider({
      minDelaySeconds: settings.mock.min_delay_seconds,
      maxDelaySeconds: settings.mock.max_delay_seconds,
      failureRate: settings.mock.failure_rate,
    });
  }
  const provider = new AnthropicProvider(env.ANTHROPIC_API_KEY ?? "");
  if (!announced) {
    // 只印末四碼，供對照 Console
    console.log(`使用 Anthropic 金鑰 ${provider.keyHint}`);
    announced = true;
  }
  return provider;
}
