import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
// twilio is CommonJS; a named import only works because bundlers (Next.js
// included) synthesize one from module.exports. Node's native ESM loader
// (which this test runs under) does not do that, so it has to be the default
// import — matching what the webhook route now uses too.
import twilioPkg from "twilio";
const { validateRequest } = twilioPkg;

/**
 * Sanity-checks that this project's actual usage of `twilio.validateRequest`
 * (same argument shapes as app/api/whatsapp/webhook/route.ts) accepts a
 * genuinely valid signature and rejects a tampered one. This is the only
 * thing standing between the webhook and anyone who finds its URL, so it's
 * worth confirming directly rather than trusting the call looks right.
 */

const authToken = "test-auth-token";
const url = "https://example.vercel.app/api/whatsapp/webhook";
const params = { From: "whatsapp:+15551234567", Body: "add task buy milk" };

function signAs(twilioWould: (authToken: string, url: string, params: Record<string, string>) => string) {
  return twilioWould(authToken, url, params);
}

// Reimplements Twilio's own signing algorithm independently of the package
// under test, so a passing test means the package's *validator* agrees with
// the documented algorithm — not just with itself.
function twilioSignature(token: string, requestUrl: string, body: Record<string, string>): string {
  const data =
    requestUrl +
    Object.keys(body)
      .sort()
      .map((key) => key + body[key])
      .join("");
  return crypto.createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}

test("a correctly signed request is accepted", () => {
  const signature = signAs(twilioSignature);
  assert.equal(validateRequest(authToken, signature, url, params), true);
});

test("a wrong auth token is rejected", () => {
  const signature = signAs(twilioSignature);
  assert.equal(validateRequest("wrong-token", signature, url, params), false);
});

test("a tampered body is rejected even with a validly-formed signature", () => {
  const signature = signAs(twilioSignature);
  const tampered = { ...params, Body: "delete everything" };
  assert.equal(validateRequest(authToken, signature, url, tampered), false);
});

test("a tampered URL is rejected", () => {
  const signature = signAs(twilioSignature);
  assert.equal(
    validateRequest(authToken, signature, "https://attacker.example/webhook", params),
    false
  );
});
