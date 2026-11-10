// Anthropic 官方 SDK。只能在伺服器端（背景工作）使用；金鑰只從伺服器的環境變數讀取。
import Anthropic from "@anthropic-ai/sdk";
import { LLMCallError, type LLMProvider, type LLMRequest, type LLMResponse } from "./types";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  /** 金鑰末四碼，供對照 Console；完整金鑰不記錄、不輸出。 */
  readonly keyHint: string;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    if (typeof window !== "undefined") throw new Error("模型金鑰不可在瀏覽器端使用");
    if (apiKey.trim() === "") {
      throw new LLMCallError("缺少 ANTHROPIC_API_KEY，請在 web/.env.local 填入，或改用 LLM_PROVIDER=mock。", {
        retryable: false,
      });
    }
    this.keyHint = `...${apiKey.trim().slice(-4)}`;
    // 重試由我們自己的流程控制（最多重試 2 次，並把原因告訴模型），所以關掉 SDK 內建的重試
    this.client = new Anthropic({ apiKey: apiKey.trim(), maxRetries: 0 });
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    // 注意：Haiku 5.5 / Sonnet 5.5 不接受自訂 temperature，所以不傳取樣參數
    const outputConfig: Anthropic.OutputConfig = {};
    if (request.jsonSchema) outputConfig.format = { type: "json_schema", schema: request.jsonSchema };
    if (request.effort) outputConfig.effort = request.effort;

    const started = Date.now();
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.user }],
          thinking: { type: request.thinking },
          ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
        },
        { timeout: request.timeoutSeconds * 1000 },
      );
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        throw new LLMCallError(`模型超過 ${request.timeoutSeconds} 秒沒有回應`);
      }
      if (error instanceof Anthropic.RateLimitError) throw new LLMCallError("呼叫太頻繁，被暫時限流");
      if (error instanceof Anthropic.APIConnectionError) throw new LLMCallError("無法連線到模型服務");
      if (error instanceof Anthropic.APIError) {
        const status = error.status ?? 0;
        throw new LLMCallError(`模型服務回應錯誤（HTTP ${status}）：${error.message}`, {
          retryable: status >= 500 || status === 408 || status === 409,
        });
      }
      throw error;
    }

    if (message.stop_reason === "refusal") {
      throw new LLMCallError("模型拒絕處理這段內容", { retryable: false });
    }
    // 回應開頭可能是 thinking 區塊，所以依 type 找文字，不依位置
    const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    return {
      text,
      model: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      latencyMs: Date.now() - started,
      stopReason: message.stop_reason,
    };
  }
}
