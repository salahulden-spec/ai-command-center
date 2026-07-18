"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PRIMARY_NAV, SECONDARY_NAV, isNavActive } from "./nav-links";
import type { User } from "firebase/auth";

export function Sidebar({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border/60 bg-background/80 backdrop-blur-sm md:flex">
      <div className="flex items-center gap-2 px-5 py-6">
        <span className="glow-text font-mono text-sm font-medium tracking-tight">
          AI Command Center
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {PRIMARY_NAV.map((link) => {
          const active = isNavActive(pathname, link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "glow-border border bg-card/60 text-primary"
                  : "text-muted-foreground hover:bg-card/40 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {link.label}
            </Link>
          );
        })}

        <div className="mt-4 border-t border-border/60 pt-4">
          {SECONDARY_NAV.map((link) => {
            const active = isNavActive(pathname, link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 font-mono text-xs uppercase tracking-widest transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="flex items-center gap-3 border-t border-border/60 px-4 py-4">
        <div className="glow-border flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-card font-mono text-xs text-primary">
          {user.email?.[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-foreground">{user.email}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onSignOut} aria-label="Sign out">
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </div>
    </aside>
  );
}
