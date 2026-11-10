// 後台：修改全站額度（PRD E-2）。寫入 settings 表，額度函式每次都讀這張表，所以立即生效。
import { NextResponse, type NextRequest } from "next/server";
import { adminGuard } from "@/lib/admin-api";
import { copy } from "@/lib/copy";
import { settingsUpdateSchema } from "@/lib/core/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: NextRequest) {
  const denied = await adminGuard();
  if (denied) return denied;

  const parsed = settingsUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: copy.admin.invalidNumber }, { status: 400 });

  const now = new Date().toISOString();
  const rows = Object.entries(parsed.data).map(([key, value]) => ({ key, value, updated_at: now }));
  const { error } = await createAdminClient().from("settings").upsert(rows, { onConflict: "key" });
  if (error) return NextResponse.json({ message: copy.admin.saveFailed }, { status: 500 });
  return NextResponse.json({ ok: true });
}
