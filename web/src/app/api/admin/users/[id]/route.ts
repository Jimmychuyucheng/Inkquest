// 後台：設定或清除個別使用者的每日額度（PRD E-2）。
import { NextResponse, type NextRequest } from "next/server";
import { adminGuard } from "@/lib/admin-api";
import { copy } from "@/lib/copy";
import { userQuotaSchema } from "@/lib/core/admin";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard();
  if (denied) return denied;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ message: copy.admin.userNone }, { status: 404 });
  const parsed = userQuotaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: copy.admin.invalidNumber }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("profiles")
    .update({ daily_quota_override: parsed.data.daily_quota_override })
    .eq("id", id)
    .select("id");
  if (error) return NextResponse.json({ message: copy.admin.saveFailed }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ message: copy.admin.userNone }, { status: 404 });
  return NextResponse.json({ ok: true });
}
