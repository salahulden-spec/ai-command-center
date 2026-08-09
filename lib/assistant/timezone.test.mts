import test from "node:test";
import assert from "node:assert/strict";
import { ASSISTANT_TIME_ZONE, formatInZone, zonedTimeToUtc } from "./timezone.ts";

test("a UTC+4 zone (no DST) converts by a flat 4 hours", () => {
  const utc = zonedTimeToUtc("2026-08-01T09:00:00", "Asia/Dubai");
  assert.equal(utc.toISOString(), "2026-08-01T05:00:00.000Z");
});

test("America/New_York in summer (EDT, UTC-4) accounts for DST", () => {
  const utc = zonedTimeToUtc("2026-07-15T09:00:00", "America/New_York");
  assert.equal(utc.toISOString(), "2026-07-15T13:00:00.000Z");
});

test("America/New_York in winter (EST, UTC-5) differs from summer by an hour", () => {
  const utc = zonedTimeToUtc("2026-01-15T09:00:00", "America/New_York");
  assert.equal(utc.toISOString(), "2026-01-15T14:00:00.000Z");
});

test("an explicit offset the model was told not to send is honoured, not fatal", () => {
  // 09:00 at +04:00 is 05:00 UTC, regardless of which zone was configured.
  const result = zonedTimeToUtc("2026-08-06T09:00:00+04:00", "America/New_York");
  assert.equal(result.toISOString(), "2026-08-06T05:00:00.000Z");

  const zulu = zonedTimeToUtc("2026-08-06T05:00:00Z", "Asia/Muscat");
  assert.equal(zulu.toISOString(), "2026-08-06T05:00:00.000Z");
});

test("UTC is a no-op", () => {
  const utc = zonedTimeToUtc("2026-08-01T09:00:00", "UTC");
  assert.equal(utc.toISOString(), "2026-08-01T09:00:00.000Z");
});

/**
 * The bug all of this exists to prevent: the assistant was told the time by a
 * server whose clock is UTC, so "in two hours" was two hours after a moment
 * four hours in the owner's past, and the reminder fired at the wrong time —
 * or, for one that had already passed, the instant it was created.
 *
 * Both halves of that round trip are asserted here: stating the clock, and
 * reading an answer written against it.
 */
test("stating the time and reading it back agree on the owner's clock", () => {
  const instant = new Date("2026-08-09T08:20:00.000Z");

  // What the system prompt puts in front of the model.
  const stated = formatInZone(instant, "Asia/Muscat");
  assert.match(stated, /12:20\s?PM/, `Muscat is UTC+4, got "${stated}"`);
  assert.match(formatInZone(instant, "UTC"), /8:20\s?AM/, "and the server's own clock is not it");

  // "In two hours", as the model would answer it against that stated time.
  const answered = zonedTimeToUtc("2026-08-09T14:20:00", "Asia/Muscat");
  assert.equal(answered.toISOString(), "2026-08-09T10:20:00.000Z");
  assert.equal(
    answered.getTime() - instant.getTime(),
    2 * 60 * 60 * 1000,
    "two hours after the moment the user asked, not after the server's idea of now"
  );
});

test("a zone is always resolved, so nothing silently formats as UTC by accident", () => {
  assert.ok(ASSISTANT_TIME_ZONE.length > 0);
  // Round-trips through Intl, i.e. it is a zone the platform actually knows.
  assert.doesNotThrow(() => formatInZone(new Date(), ASSISTANT_TIME_ZONE));
});
