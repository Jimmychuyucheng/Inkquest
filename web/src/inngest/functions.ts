// 開庭的背景工作：每個階段是一個步驟，使用者關閉頁面後仍會繼續（PRD C-4）。
import { personas, settings } from "@/lib/core/shared";
import { PHASES, failCourt, runAdviceAddon, type CourtDeps } from "@/lib/court/pipeline";
import { createSupabaseStore } from "@/lib/court/store";
import { getProvider } from "@/lib/llm";
import { createAdminClient } from "@/lib/supabase/admin";
import { ADVICE_EVENT, COURT_EVENT, inngest } from "./client";

function deps(): CourtDeps {
  return { store: createSupabaseStore(createAdminClient()), provider: getProvider(settings), settings, personas };
}

export const holdCourt = inngest.createFunction(
  {
    id: "hold-court",
    triggers: [{ event: COURT_EVENT }],
    // 模型呼叫的重試由我們自己的流程處理；這裡的重試只用來應付資料庫或網路的暫時問題
    retries: 1,
    onFailure: async ({ event }) => {
      const id = String(event.data.event.data.submissionId ?? "");
      if (id) await failCourt(id, "internal", { store: createSupabaseStore(createAdminClient()) });
    },
  },
  async ({ event, step }) => {
    const id = String(event.data.submissionId);
    let note = "";
    for (const [name, phase] of PHASES) {
      const result = await step.run(name, () => phase(id, deps()));
      note = result.note;
      if (!result.proceed) break;
    }
    return { submissionId: id, note };
  },
);

export const addAdvice = inngest.createFunction(
  {
    id: "add-advice",
    triggers: [{ event: ADVICE_EVENT }],
    retries: 1,
    // 工作本身出錯時，把狀態改回 done：判決還在，只是沒有修改建議
    onFailure: async ({ event }) => {
      const id = String(event.data.event.data.submissionId ?? "");
      if (!id) return;
      await createAdminClient().from("submissions").update({ status: "done" }).eq("id", id).eq("status", "advice_running");
    },
  },
  async ({ event, step }) => {
    const id = String(event.data.submissionId);
    const result = await step.run("advice", () => runAdviceAddon(id, deps()));
    return { submissionId: id, note: result.note };
  },
);

export const functions = [holdCourt, addAdvice];
