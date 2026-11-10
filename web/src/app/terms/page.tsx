import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { acceptTerms } from "./actions";

export default async function TermsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  if (user.profile?.terms_accepted_at) redirect("/submit");
  const t = copy.terms;
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-heading text-2xl font-semibold">{t.title}</h1>
      <p className="text-muted-foreground">{t.intro}</p>
      <ul className="list-disc space-y-2 rounded-lg border bg-card py-5 pl-9 pr-5 leading-relaxed">
        {t.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
        <li>
          <a href={t.providerPolicyUrl} target="_blank" rel="noreferrer" className="underline">
            {t.providerPolicy}
          </a>
        </li>
      </ul>
      <form action={acceptTerms} className="space-y-4">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="agree" required className="mt-1" />
          <span>{t.agree}</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="research" className="mt-1" />
          <span>{t.research}</span>
        </label>
        {params.error && (
          <p role="alert" className="text-sm text-destructive">
            {params.error === "agree" ? t.mustAgree : copy.errors.generic}
          </p>
        )}
        <button type="submit" className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground">
          {t.submit}
        </button>
      </form>
    </div>
  );
}
