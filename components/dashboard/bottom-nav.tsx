"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MOBILE_NAV, isNavActive } from "./nav-links";

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="glow-border fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 backdrop-blur-sm md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {MOBILE_NAV.map((link) => {
        const active = isNavActive(pathname, link.href);
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 px-2 py-2.5 text-[0.65rem] transition-colors",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className={cn("h-5 w-5", active && "glow-text")} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
