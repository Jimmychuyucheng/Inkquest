import { SubmitForm } from "@/components/submit-form";
import { getBudgetStatus } from "@/lib/admin-server";
import { requireTermsAccepted } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { quotaBlockReason, rejectMessage } from "@/lib/core/quota";
import { getQuotaStatus } from "@/lib/quota-server";

export default async function SubmitPage() {
  const user = await requireTermsAccepted();
  const [status, budget] = await Promise.all([getQuotaStatus(user.id), getBudgetStatus().catch(() => null)]);
  const blocked = status ? (budget?.level === "paused" ? "budget_paused" : quotaBlockReason(status)) : null;
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-heading text-2xl font-semibold">{copy.submit.title}</h1>
      {!status ? (
        <p role="alert" className="text-destructive">{copy.errors.generic}</p>
      ) : (
        <>
          {blocked && (
            <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {rejectMessage(blocked)}
            </p>
          )}
          <SubmitForm remaining={blocked ? 0 : status.remaining} limit={status.limit} />
        </>
      )}
    </div>
  );
}
