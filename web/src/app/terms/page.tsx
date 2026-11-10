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
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="text-stone-700">{t.intro}</p>
      <ul className="list-disc space-y-2 pl-5 text-stone-700">
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
          <p role="alert" className="text-sm text-red-700">
            {params.error === "agree" ? t.mustAgree : copy.errors.generic}
          </p>
        )}
        <button type="submit" className="rounded bg-stone-900 px-5 py-2.5 text-white">
          {t.submit}
        </button>
      </form>
    </div>
  );
}
