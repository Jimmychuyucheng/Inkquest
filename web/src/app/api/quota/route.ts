// 今日剩餘次數。
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { getQuotaStatus } from "@/lib/quota-server";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: copy.errors.notLoggedIn }, { status: 401 });
  const status = await getQuotaStatus(user.id);
  if (!status) return NextResponse.json({ message: copy.errors.generic }, { status: 500 });
  return NextResponse.json(status);
}
