// 模型呼叫層的共用型別。與 research/court/llm.py 對應。

export interface LLMRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  timeoutSeconds: number;
  thinking: "disabled" | "adaptive";
  effort: "low" | "medium" | "high" | null;
  jsonSchema: Record<string, unknown> | null;
  /** 給 mock 與紀錄用的附註（角色、陪審員編號等），不會送給模型。 */
  meta: Record<string, unknown>;
}

export interface LLMResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  stopReason: string | null;
}

/** 模型呼叫失敗。retryable 表示再試一次可能會成功。 */
export class LLMCallError extends Error {
  readonly retryable: boolean;
  constructor(message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.retryable = options.retryable ?? true;
  }
}

export interface LLMProvider {
  readonly name: "anthropic" | "mock";
  complete(request: LLMRequest): Promise<LLMResponse>;
}
