"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, MessageCircle, Settings, LogOut } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/dashboard/sidebar";
import { BottomNav } from "@/components/dashboard/bottom-nav";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading, isAllowed, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user || !isAllowed) {
      router.replace("/login");
    }
  }, [loading, user, isAllowed, router]);

  if (loading || !user || !isAllowed) {
    return (
      <div className="flex min-h-screen flex-col gap-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Sidebar user={user} onSignOut={() => void signOut()} />

      <header
        className="glow-border sticky top-0 z-30 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur-sm md:hidden"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <span className="glow-text font-mono text-sm font-medium tracking-tight">
          AI Command Center
        </span>
        <div className="flex items-center gap-1">
          <Link
            href="/reminders"
            className="rounded-md p-2 text-muted-foreground hover:text-foreground"
            aria-label="Reminders"
          >
            <Bell className="h-4 w-4" />
          </Link>
          <Link
            href="/chat"
            className="rounded-md p-2 text-muted-foreground hover:text-foreground"
            aria-label="Chat"
          >
            <MessageCircle className="h-4 w-4" />
          </Link>
          <Link
            href="/settings"
            className="rounded-md p-2 text-muted-foreground hover:text-foreground"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <button
            onClick={() => void signOut()}
            className="rounded-md p-2 text-muted-foreground hover:text-foreground"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="min-h-screen p-6 pb-24 md:ml-60 md:pb-6">{children}</main>

      <BottomNav />
    </div>
  );
}
