// 管理者後台（PRD E-1 用量總覽、E-2 調整額度、E-6 匯出投稿統計）。
// 只有 role = admin 可以進入；不顯示任何文章內容。
import { AdminQuota } from "@/components/admin-quota";
import { buttonVariants } from "@/components/ui/button";
import { getAdminOverview, type AdminOverview } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { formatUsd, SOURCES, type UsageSummary } from "@/lib/core/usage";

const t = copy.admin;
const num = (n: number) => n.toLocaleString("zh-TW");

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function PeriodUsage({ title, usage }: { title: string; usage: UsageSummary }) {
  const s = usage.submissions;
  return (
    <section className="space-y-3">
      <h3 className="font-medium">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t.submissions} value={num(s.total)} detail={t.submissionsDetail(s.done, s.failed, s.inProgress)} />
        <Stat label={t.activeUsers} value={num(usage.activeUsers)} />
        <Stat
          label={t.tokens}
          value={num(usage.total.inputTokens + usage.total.outputTokens)}
          detail={t.tokensDetail(num(usage.total.inputTokens), num(usage.total.outputTokens))}
        />
        <Stat label={t.cost} value={formatUsd(usage.total.costUsd)} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="py-2 font-normal"></th>
              <th scope="col" className="py-2 text-right font-normal">{t.calls}</th>
              <th scope="col" className="py-2 text-right font-normal">{t.inputTokens}</th>
              <th scope="col" className="py-2 text-right font-normal">{t.outputTokens}</th>
              <th scope="col" className="py-2 text-right font-normal">{t.cost}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {SOURCES.map((source) => {
              const row = usage.bySource[source];
              return (
                <tr key={source} className="border-b last:border-0">
                  <th scope="row" className="py-2 text-left font-normal">{t.sources[source]}</th>
                  <td className="py-2 text-right">{num(row.calls)}</td>
                  <td className="py-2 text-right">{num(row.inputTokens)}</td>
                  <td className="py-2 text-right">{num(row.outputTokens)}</td>
                  <td className="py-2 text-right">{formatUsd(row.costUsd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {usage.unpricedModels.length > 0 && (
        <p className="text-xs text-muted-foreground">{t.unpriced(usage.unpricedModels.join("、"))}</p>
      )}
    </section>
  );
}

function Budget({ budget }: { budget: AdminOverview["budget"] }) {
  const ratio = budget.budgetUsd > 0 ? budget.costUsd / budget.budgetUsd : 1;
  const pct = Math.round(ratio * 100);
  const bar = budget.level === "paused" ? "bg-destructive" : budget.level === "warn" ? "bg-amber-500" : "bg-primary";
  return (
    <section className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{t.budgetTitle}</h3>
        <p className="text-sm tabular-nums">{t.budgetLine(formatUsd(budget.costUsd), formatUsd(budget.budgetUsd))}</p>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={t.budgetTitle}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(pct, 100)}
      >
        <div className={`h-full ${bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {budget.level === "warn" && (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{t.budgetWarn(pct)}</p>
      )}
      {budget.level === "paused" && (
        <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{t.budgetPaused}</p>
      )}
    </section>
  );
}

export default async function AdminPage() {
  await requireAdmin();
  let overview: AdminOverview;
  try {
    overview = await getAdminOverview();
  } catch {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold">{t.title}</h1>
        <p role="alert" className="text-destructive">{t.loadFailed}</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <h1 className="font-heading text-2xl font-semibold">{t.title}</h1>

      <section className="space-y-6" aria-labelledby="usage-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="usage-title" className="font-heading text-xl font-semibold">{t.usageTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.totalUsers(overview.totalUsers)}</p>
        </div>
        <Budget budget={overview.budget} />
        <PeriodUsage title={t.today} usage={overview.today} />
        <PeriodUsage title={t.month} usage={overview.month} />
        <p className="text-xs text-muted-foreground">{t.costNote}</p>
      </section>

      <section className="space-y-4" aria-labelledby="quota-title">
        <h2 id="quota-title" className="font-heading text-xl font-semibold">{t.quotaTitle}</h2>
        <AdminQuota
          dailyQuota={overview.settings.daily_quota_per_user}
          globalLimit={overview.settings.global_daily_limit}
          globalUsedToday={overview.today.submissions.total - overview.today.submissions.failed}
        />
      </section>

      <section className="space-y-3" aria-labelledby="export-title">
        <h2 id="export-title" className="font-heading text-xl font-semibold">{t.exportTitle}</h2>
        <p className="text-sm text-muted-foreground">{t.exportIntro}</p>
        {/* 一般表單：不需要 JavaScript 也能下載 */}
        <form action="/api/admin/export" method="get" className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="all" value="1" className="mt-1" />
            <span>{t.exportAll}</span>
          </label>
          <button type="submit" className={buttonVariants()}>{t.exportButton}</button>
        </form>
      </section>
    </div>
  );
}
