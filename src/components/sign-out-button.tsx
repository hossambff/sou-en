"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
      }}
      className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-ink-soft transition hover:bg-bg-deep"
    >
      Sign out
    </button>
  );
}
