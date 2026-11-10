import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";
import "./globals.css";

export const metadata: Metadata = {
  title: `${copy.appName}｜${copy.appSubtitle}`,
  description: copy.tagline,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="zh-Hant-TW" className="h-full font-sans antialiased">
      <body className="flex min-h-full flex-col">
        <header className="border-b bg-card">
          <div className="mx-auto flex w-full max-w-[960px] items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-baseline font-heading text-lg font-semibold">
              {copy.appName}
              <span className="ml-2 hidden font-sans text-sm font-normal text-muted-foreground sm:inline">{copy.appSubtitle}</span>
            </Link>
            {user && (
              <div className="flex items-center gap-4">
                <nav className="flex items-center gap-4 text-sm">
                  <Link href="/submit" className="underline-offset-4 hover:underline">{copy.nav.submit}</Link>
                  <Link href="/history" className="underline-offset-4 hover:underline">{copy.nav.history}</Link>
                </nav>
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatarUrl}
                    alt={`${user.profile?.display_name ?? user.email} 的頭像`}
                    className="h-8 w-8 rounded-full"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span
                    aria-label={`${user.email} 的頭像`}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground"
                  >
                    {(user.profile?.display_name ?? user.email).slice(0, 1).toUpperCase()}
                  </span>
                )}
                <form action="/auth/signout" method="post">
                  <button type="submit" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
                    {copy.logout}
                  </button>
                </form>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[960px] flex-1 px-4 py-8">{children}</main>
        <footer className="border-t">
          <p className="mx-auto w-full max-w-[960px] px-4 py-4 text-sm text-muted-foreground">{copy.disclaimer}</p>
        </footer>
      </body>
    </html>
  );
}
