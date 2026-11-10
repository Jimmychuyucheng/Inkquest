// 伺服器啟動時執行一次。正式環境若設成假資料模式就拒絕啟動（PRD 第 9 節）。
import { settings } from "@/lib/core/shared";
import { assertProviderAllowed } from "@/lib/llm/check";

export function register() {
  assertProviderAllowed(settings);
}
