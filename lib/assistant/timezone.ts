/**
 * One zone, everywhere.
 *
 * The assistant is told what time it is, reasons about "in two hours" against
 * that, and answers with a bare wall-clock string like "2026-08-10T09:00:00".
 * Three separate places then turn that string into an instant. If any of them
 * disagrees about which zone the wall clock belongs to, the reminder lands at
 * the wrong time — and it lands at a *different* wrong time depending on which
 * path handled it, which is exactly the symptom this module exists to stop.
 *
 * `ASSISTANT_TIMEZONE` is the canonical value. A browser cannot read a
 * server-only variable, so `NEXT_PUBLIC_ASSISTANT_TIMEZONE` mirrors it for the
 * client; both must be set to the same IANA zone.
 *
 * With neither set, this falls back to the zone the process is actually running
 * in rather than to UTC. That is not a fix — on Vercel the process *is* UTC —
 * but it degrades to "right on the user's own machine" instead of "silently
 * four hours off", and it says so in the log.
 */
function resolveTimeZone(): string {
  const configured =
    (typeof window === "undefined" ? process.env.ASSISTANT_TIMEZONE : undefined) ||
    process.env.NEXT_PUBLIC_ASSISTANT_TIMEZONE;
  if (configured) return configured;

  let runtime = "UTC";
  try {
    runtime = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    // Intl is always present in both runtimes; the guard is belt and braces.
  }
  console.warn(
    `[assistant] Neither ASSISTANT_TIMEZONE nor NEXT_PUBLIC_ASSISTANT_TIMEZONE is set. ` +
      `Falling back to this runtime's zone (${runtime}). Reminder times will be wrong ` +
      `wherever that is not the owner's own zone.`
  );
  return runtime;
}

export const ASSISTANT_TIME_ZONE: string = resolveTimeZone();

/**
 * A date as the owner would read it off a clock, whatever zone the process
 * happens to run in. Cloud Functions and Vercel both run in UTC, so a bare
 * `toLocaleString()` states a time the owner never asked for.
 */
export function formatInZone(date: Date, timeZone: string = ASSISTANT_TIME_ZONE): string {
  return date.toLocaleString("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Converts a timezone-naive local time string (e.g. "2026-08-01T09:00:00", as
 * the AI is instructed to produce) into the correct UTC instant for a given
 * IANA zone.
 *
 * There's no direct stdlib function for "wall clock in zone X -> UTC", so this
 * uses the standard round-trip trick: read the string as if it were UTC, format
 * that instant back out in the target zone, and the discrepancy between the two
 * *is* the zone's offset at that instant (correctly handling DST, unlike a
 * fixed offset would).
 */
export function zonedTimeToUtc(localIso: string, timeZone: string = ASSISTANT_TIME_ZONE): Date {
  // The model is told to omit timezone suffixes, but under pressure it still
  // sometimes appends one ("2026-08-06T09:00:00+04:00"). An explicit offset is
  // unambiguous on its own — honour it directly instead of failing the write.
  const explicit = /(Z|[+-]\d{2}:?\d{2})$/i.exec(localIso);
  if (explicit) {
    const parsed = new Date(localIso);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Not a valid date-time: "${localIso}"`);
    }
    return parsed;
  }

  const asUtc = new Date(`${localIso}Z`);
  if (Number.isNaN(asUtc.getTime())) {
    throw new Error(`Not a valid date-time: "${localIso}"`);
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(asUtc)
      .map((p) => [p.type, p.value])
  );

  const asIfLocal = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return new Date(asUtc.getTime() + (asUtc.getTime() - asIfLocal));
}
