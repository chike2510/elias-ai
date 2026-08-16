"use client";

import { LoaderCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type User = { userId: string; login: string; name?: string; email?: string; avatarUrl?: string; githubConnected?: boolean; vercelConnected?: boolean };

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(pathname !== "/login");

  useEffect(() => {
    if (pathname === "/login") { setLoading(false); return; }
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json()).then((data: { user?: User | null }) => {
      if (!active) return;
      if (!data.user) router.replace("/login");
      else { setUser(data.user); window.localStorage.setItem("elias.user", JSON.stringify(data.user)); }
    }).catch(() => { if (active) router.replace("/login"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pathname, router]);

  if (pathname === "/login") return <>{children}</>;
  if (loading || !user) return <main className="auth-loading"><LoaderCircle size={20} className="spin" /><span>Preparing your workspace…</span></main>;
  return <>{children}</>;
}
