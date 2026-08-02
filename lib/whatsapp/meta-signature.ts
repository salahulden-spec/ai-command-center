import crypto from "node:crypto";

/**
 * Verifies Meta's `X-Hub-Signature-256` header: `sha256=` followed by a
 * hex HMAC-SHA256 of the *raw* request body, keyed with the app secret.
 *
 * Must run against the raw bytes, before any JSON.parse — re-serializing a
 * parsed body can reorder keys or change whitespace, which would silently
 * break every signature.
 */
export function verifyMetaSignature(
  appSecret: string,
  signatureHeader: string | null,
  rawBody: string
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf-8").digest("hex");

  // Constant-time comparison: a naive `===` leaks how many leading
  // characters matched via response-time differences.
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
