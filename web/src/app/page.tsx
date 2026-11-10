import { Gavel } from "lucide-react";
import Link from "next/link";
import { PersonaIcon } from "@/components/persona-icon";
import { buttonVariants } from "@/components/ui/button";
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
    <div className="space-y-12">
      <section className="space-y-5 rounded-xl bg-primary p-6 text-primary-foreground sm:p-10">
        <Gavel className="size-8 text-brass" aria-hidden />
        <h1 className="font-heading text-3xl font-semibold sm:text-4xl">{copy.appSubtitle}</h1>
        <p className="max-w-2xl text-lg leading-relaxed opacity-90">{copy.tagline}</p>
        <ol className="flex flex-wrap gap-3 text-sm">
          {copy.steps.map((step, index) => (
            <li key={step} className="rounded-full border border-primary-foreground/30 px-4 py-1.5">
              {index + 1}. {step}
            </li>
          ))}
        </ol>
        {!supabaseConfigured() ? (
          <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {copy.setupNeeded}
          </p>
        ) : user ? (
          <Link href="/submit" className={buttonVariants({ variant: "secondary", size: "lg" })}>
            {copy.home.start}
          </Link>
        ) : (
          <LoginButton />
        )}
        {params.error && (
          <p role="alert" className="text-sm text-amber-200">
            {copy.loginFailed}
          </p>
        )}
      </section>

      <section className="space-y-5">
        <h2 className="font-heading text-2xl font-semibold">{copy.home.juryTitle}</h2>
        <p className="text-muted-foreground">{copy.home.juryIntro}</p>
        {GROUPS.map((group) => (
          <div key={group} className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">{group}</h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {personas
                .filter((p) => p.group === group)
                .map((p) => (
                  <li key={p.code} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                    <PersonaIcon code={p.code} />
                    <span className="text-sm font-medium">{p.name}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
