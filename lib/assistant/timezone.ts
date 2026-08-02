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
export function zonedTimeToUtc(localIso: string, timeZone: string): Date {
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
