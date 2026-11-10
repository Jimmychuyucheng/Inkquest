// 後台：匯出投稿統計 CSV（PRD E-6）。不讀取文章內容、標題與 email。
// 預設只匯出有同意研究使用（A-7）的使用者；?all=1 時全部匯出（research_consent 欄位會標示）。
import { NextResponse, type NextRequest } from "next/server";
import { adminGuard } from "@/lib/admin-api";
import { copy } from "@/lib/copy";
import { buildCsv, formatLocal, type ExportSubmission } from "@/lib/core/export";
import { settings } from "@/lib/core/shared";
import { createAdminClient } from "@/lib/supabase/admin";

const PAGE = 1000; // Supabase 一次最多回傳的筆數

export async function GET(request: NextRequest) {
  const denied = await adminGuard();
  if (denied) return denied;

  const includeAll = request.nextUrl.searchParams.get("all") === "1";
  const admin = createAdminClient();
  const rows: ExportSubmission[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = admin
      .from("submissions")
      .select(
        "user_id, genre, char_count, modules, status, jurors_ok, stats, created_at, finished_at, " +
          "profiles!inner(research_consent), juror_results(juror_code, status, score:output->score)",
      )
      .order("created_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (!includeAll) query = query.eq("profiles.research_consent", true);
    const { data, error } = await query;
    if (error) {
      console.error("匯出投稿統計失敗", error.code);
      return NextResponse.json({ message: copy.admin.loadFailed }, { status: 500 });
    }
    for (const row of (data ?? []) as unknown as (Omit<ExportSubmission, "research_consent"> & {
      profiles: { research_consent: boolean };
    })[]) {
      const { profiles, ...rest } = row;
      rows.push({ ...rest, research_consent: profiles.research_consent });
    }
    if (!data || data.length < PAGE) break;
  }

  const stamp = formatLocal(new Date().toISOString(), settings.web.timezone).slice(0, 10);
  const filename = `inkquest-submissions-${stamp}${includeAll ? "-all" : ""}.csv`;
  return new NextResponse(buildCsv(rows, settings.web.timezone), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
