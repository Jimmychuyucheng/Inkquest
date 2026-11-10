// Inngest 透過這個端點呼叫背景工作。正式環境的請求會以 INNGEST_SIGNING_KEY 驗證簽章。
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// 陪審員階段最長可能超過 2 分鐘（逾時 45 秒 × 最多 3 次嘗試），所以把執行時間上限拉長
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
