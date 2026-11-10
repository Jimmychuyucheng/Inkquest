"use client";

import { useState } from "react";
import { copy } from "@/lib/copy";
import { createClient } from "@/lib/supabase/client";

export function LoginButton() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn() {
    setBusy(true);
    setFailed(false);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="rounded-lg bg-secondary px-5 py-2.5 font-medium text-secondary-foreground disabled:opacity-60"
      >
        {copy.login}
      </button>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-amber-200">
          {copy.loginFailed}
        </p>
      )}
    </div>
  );
}
