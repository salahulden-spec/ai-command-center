"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MOBILE_NAV, isNavActive } from "./nav-links";

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="glow-border pb-safe fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 backdrop-blur-md md:hidden"
      aria-label="Primary"
    >
      {MOBILE_NAV.map((link) => {
        const active = isNavActive(pathname, link.href);
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // min-h-14 so every target clears the 44px minimum even once the
              // label wraps — the old py-2.5 left them around 38px.
              "tap relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 text-[0.65rem]",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            {/* A lit bar on the edge the nav is attached to: readable at a
                glance without relying on the colour shift alone. */}
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-4 top-0 h-0.5 rounded-full transition-opacity",
                active ? "glow-border bg-primary opacity-100" : "opacity-0"
              )}
            />
            <Icon className={cn("h-5 w-5", active && "glow-text")} />
            <span className="leading-none">{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
