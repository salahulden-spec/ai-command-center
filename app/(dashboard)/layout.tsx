"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MessageCircle, Search, Settings } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/dashboard/sidebar";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { CommandPalette } from "@/components/command-palette/command-palette";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, loading, isAllowed, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user || !isAllowed) {
      router.replace("/login");
    }
  }, [loading, user, isAllowed, router]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
      <Sidebar user={user} onSignOut={() => void signOut()} onOpenPalette={() => setPaletteOpen(true)} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      {/* Three actions, not five: at 44px each they now clear the minimum
          touch target, and sign-out lives on the Settings page it links to. */}
      <header className="glow-border pt-safe sticky top-0 z-30 border-b bg-background/90 backdrop-blur-sm md:hidden">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="glow-text font-mono text-sm font-medium tracking-tight">
            AI Command Center
          </span>
          <div className="flex items-center">
            <button
              onClick={() => setPaletteOpen(true)}
              className="tap flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground active:bg-accent active:text-foreground"
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </button>
            <Link
              href="/chat"
              className="tap flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground active:bg-accent active:text-foreground"
              aria-label="Chat"
            >
              <MessageCircle className="h-5 w-5" />
            </Link>
            <Link
              href="/settings"
              className="tap flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground active:bg-accent active:text-foreground"
              aria-label="Settings"
            >
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Keyed on the route so each navigation replays the entrance animation,
          which gives the app a sense of response on a slow mobile connection
          well before the data itself arrives. */}
      <main key={pathname} className="animate-rise min-h-screen p-4 pb-28 sm:p-6 md:ml-60 md:pb-6">
        {children}
      </main>

      <BottomNav />
    </div>
  );
}
