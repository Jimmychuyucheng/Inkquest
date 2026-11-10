// 背景工作（Inngest）的連線設定。
// 本機開發：搭配 Inngest 開發伺服器（npx inngest-cli@latest dev），不需要金鑰。
// 正式環境：從環境變數讀取 INNGEST_EVENT_KEY 與 INNGEST_SIGNING_KEY。
import { Inngest } from "inngest";

export const COURT_EVENT = "court/submission.created";
/** 結果頁補勾修改建議（PRD D-4）。 */
export const ADVICE_EVENT = "court/advice.requested";

export const inngest = new Inngest({
  id: "inkquest",
  // 沒有明確設定 INNGEST_DEV 時：非正式環境一律連本機的開發伺服器
  ...(process.env.INNGEST_DEV === undefined ? { isDev: process.env.NODE_ENV !== "production" } : {}),
});
