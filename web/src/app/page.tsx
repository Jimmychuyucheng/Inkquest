import Link from "next/link";
import { LoginButton } from "@/components/login-button";
import { getCurrentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { GROUPS, personas } from "@/lib/core/shared";
import { supabaseConfigured } from "@/lib/env";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold">{copy.appSubtitle}</h1>
        <p className="max-w-2xl text-lg text-stone-700">{copy.tagline}</p>
        <ol className="flex flex-wrap gap-3 text-sm text-stone-600">
          {copy.steps.map((step, index) => (
            <li key={step} className="rounded border border-stone-300 px-3 py-1.5">
              {index + 1}. {step}
            </li>
          ))}
        </ol>
        {!supabaseConfigured() ? (
          <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {copy.setupNeeded}
          </p>
        ) : user ? (
          <Link href="/submit" className="inline-block rounded bg-stone-900 px-5 py-2.5 text-white">
            {copy.submit.title}
          </Link>
        ) : (
          <LoginButton />
        )}
        {params.error && (
          <p role="alert" className="text-sm text-red-700">
            {copy.loginFailed}
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">陪審團陣容</h2>
        <p className="text-sm text-stone-600">共 20 位，每次投稿依組別抽出 10 位。</p>
        {GROUPS.map((group) => (
          <div key={group}>
            <h3 className="mb-2 text-sm font-medium text-stone-500">{group}</h3>
            <ul className="flex flex-wrap gap-2">
              {personas
                .filter((p) => p.group === group)
                .map((p) => (
                  <li key={p.code} className="rounded border border-stone-300 px-3 py-1.5 text-sm">
                    {p.name}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
