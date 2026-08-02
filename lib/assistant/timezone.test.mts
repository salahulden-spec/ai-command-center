import test from "node:test";
import assert from "node:assert/strict";
import { zonedTimeToUtc } from "./timezone.ts";

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
