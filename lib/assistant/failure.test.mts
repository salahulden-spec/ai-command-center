import test from "node:test";
import assert from "node:assert/strict";
import { describeFailure } from "./failure.ts";

/**
 * The strings below are copied from real AI Gateway responses this workspace
 * actually received, not invented — that is the whole point of the test. A
 * classifier written against imagined error text is a classifier that fails on
 * the day it matters.
 */
const RATE_LIMITED =
  "Free tier requests on this model are rate-limited. Upgrade to paid credits at https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dtop-up for unrestricted access.";
const NO_MODEL =
  "Free tier users do not have access to this model. Upgrade to paid credits at https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dtop-up for unrestricted access.";

test("a rate limit says to wait, not to retype", () => {
  const said = describeFailure(new Error(RATE_LIMITED));
  assert.match(said, /rate limit/i);
  assert.match(said, /minute/i, "and says what to do about it");
  assert.ok(!said.includes("http"), "without pasting a billing URL into a chat window");
});

test("a blocked model is named as a settings problem, not a glitch", () => {
  const said = describeFailure(new Error(NO_MODEL));
  assert.match(said, /won't serve|model/i);
  assert.ok(
    !/try again/i.test(said),
    "because trying again will never work — that is the point of telling them"
  );
});

test("an exhausted balance is distinguished from a rate limit", () => {
  const said = describeFailure(new Error("insufficient credits for this request"));
  assert.match(said, /credit/i);
});

test("an unrecognised failure still reports its first line rather than a shrug", () => {
  const said = describeFailure(new Error("ECONNRESET reading from firestore\n  at someFrame"));
  assert.match(said, /ECONNRESET reading from firestore/);
  assert.ok(!said.includes("someFrame"), "one line, not a stack");
});

test("a very long message is trimmed instead of flooding the chat", () => {
  const said = describeFailure(new Error("x".repeat(5000)));
  assert.ok(said.length < 260, `got ${said.length} characters`);
});

test("a thrown non-Error does not crash the handler", () => {
  assert.doesNotThrow(() => describeFailure({ weird: true }));
  assert.doesNotThrow(() => describeFailure(undefined));
  assert.ok(describeFailure(undefined).length > 0);
});
