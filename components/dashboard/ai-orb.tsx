import { cn } from "@/lib/utils";

const BAR_DELAYS = ["0s", "0.15s", "0.3s", "0.45s", "0.15s"];

export function AiOrb({
  size = "lg",
  active = true,
  className,
}: {
  size?: "lg" | "md";
  active?: boolean;
  className?: string;
}) {
  const dimension = size === "lg" ? "h-40 w-40" : "h-14 w-14";

  return (
    <div className={cn("relative flex items-center justify-center", dimension, className)}>
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-full bg-primary/25 blur-2xl",
          active && "animate-breathe"
        )}
      />
      <div
        className={cn(
          "glow-border relative flex h-full w-full items-center justify-center rounded-full border bg-gradient-to-br from-card to-background",
          active && "animate-breathe"
        )}
      >
        <div className="flex items-end gap-1" aria-hidden>
          {BAR_DELAYS.map((delay, i) => (
            <span
              key={i}
              className={cn(
                "w-1 rounded-full bg-primary",
                size === "lg" ? "h-8" : "h-3",
                active && "animate-wave-bar"
              )}
              style={{ animationDelay: delay }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
