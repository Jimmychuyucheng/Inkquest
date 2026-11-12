import { Gavel } from "lucide-react";
import Link from "next/link";
import { JurySelect } from "@/components/jury-select";
import { buttonVariants } from "@/components/ui/button";
import { LoginButton } from "@/components/login-button";
import { getCurrentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { personas, settings } from "@/lib/core/shared";
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

      <figure className="space-y-2">
        {/* 全員圖：寬螢幕用橫的、手機用方的（原圖是重複圖樣，裁短不影響內容） */}
        <picture>
          <source media="(max-width: 639px)" srcSet="/jurors/all-mobile.png" width={1080} height={1080} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/jurors/all-desktop.png"
            alt={copy.home.allAlt}
            width={1920}
            height={720}
            className="w-full rounded-xl border-2 border-primary/15"
          />
        </picture>
        <figcaption className="text-center text-sm text-muted-foreground">{copy.home.juryIntro(
            personas.filter((p) => p.enabled).length,
            Object.entries(settings.jury.size_by_group).map(([g, n]) => copy.home.groupCount(g, n)).join("、"),
          )}</figcaption>
      </figure>

      <section className="space-y-4" aria-labelledby="jury-title">
        <div className="space-y-1">
          <h2 id="jury-title" className="font-heading text-2xl font-semibold">{copy.home.selectTitle}</h2>
          <p className="text-muted-foreground">{copy.home.selectIntro}</p>
        </div>
        <JurySelect />
      </section>
    </div>
  );
}
