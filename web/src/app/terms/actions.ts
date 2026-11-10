"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** 同意使用條款（必填）與研究同意（選填）。沒勾必填項目就留在原頁。 */
export async function acceptTerms(formData: FormData) {
  await requireUser();
  if (formData.get("agree") !== "on") redirect("/terms?error=agree");
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_terms", {
    p_research_consent: formData.get("research") === "on",
  });
  if (error) redirect("/terms?error=save");
  redirect("/submit");
}
