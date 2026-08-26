"use client";

import { LoaderCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type User = { userId: string; login: string; name?: string; email?: string; avatarUrl?: string; githubConnected?: boolean; vercelConnected?: boolean };

function cachedUser(): User | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.localStorage.getItem("elias.user") || "null") as User | null; } catch { return null; }
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const publicPaths = pathname === "/login" || pathname === "/privacy" || pathname === "/terms";
  const [user, setUser] = useState<User | null>(() => cachedUser());
  const [loading, setLoading] = useState(!publicPaths && !cachedUser());

  useEffect(() => {
    if (publicPaths) { setLoading(false); return; }
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    fetch("/api/auth/me", { cache: "no-store", signal: controller.signal }).then((response) => response.json()).then((data: { user?: User | null }) => {
      if (!active) return;
      if (!data.user) {
        window.localStorage.removeItem("elias.user");
        setUser(null);
        router.replace("/login");
      } else {
        setUser(data.user);
        window.localStorage.setItem("elias.user", JSON.stringify(data.user));
      }
    }).catch(() => {
      if (active && !cachedUser()) router.replace("/login");
    }).finally(() => {
      window.clearTimeout(timeout);
      if (active) setLoading(false);
    });
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [pathname, router, publicPaths]);

  if (publicPaths) return <>{children}</>;
  if (loading && !user) return <main className="auth-loading"><LoaderCircle size={20} className="spin" /><span>Preparing your workspace…</span></main>;
  return <>{children}</>;
}
