import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyMetaSignature } from "./meta-signature.ts";

const appSecret = "test-app-secret";
const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: { messages: [{ from: "971501234567", text: { body: "add task buy milk" } }] } }] }],
});

function sign(secret: string, raw: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(raw, "utf-8").digest("hex");
}

test("a correctly signed body is accepted", () => {
  assert.equal(verifyMetaSignature(appSecret, sign(appSecret, body), body), true);
});

test("a wrong app secret is rejected", () => {
  assert.equal(verifyMetaSignature("wrong-secret", sign(appSecret, body), body), false);
});

test("a tampered body is rejected even with a validly-formed signature", () => {
  const tampered = body.replace("buy milk", "delete everything");
  assert.equal(verifyMetaSignature(appSecret, sign(appSecret, body), tampered), false);
});

test("a missing header is rejected", () => {
  assert.equal(verifyMetaSignature(appSecret, null, body), false);
});

test("a header without the sha256= prefix is rejected", () => {
  const raw = crypto.createHmac("sha256", appSecret).update(body, "utf-8").digest("hex");
  assert.equal(verifyMetaSignature(appSecret, raw, body), false);
});
