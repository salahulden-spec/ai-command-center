/**
 * What to say when the assistant could not answer.
 *
 * "Something went wrong on my end" is true and useless. It reads the same
 * whether the gateway is rate-limiting, the model has been withdrawn, or a
 * Firestore write failed — so the only way to tell was to go and read the
 * server log, which is not something you do from a phone.
 *
 * This is a private assistant with one user, and that user is also the person
 * who has to fix it. Say what happened.
 */

const NO_ACCESS = "do not have access to this model";

export function describeFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  // The same condition is spelled "rate_limit_exceeded" in the gateway's error
  // type and "rate-limited" in the prose it puts in the message. Flattening
  // punctuation to spaces means one check covers both, and the next spelling
  // too.
  const text = lower.replace(/[^a-z0-9]+/g, " ");

  // Much the most likely failure on the free tier, and the one where knowing
  // the cause changes what you do: wait, rather than retype the message.
  if (text.includes("rate limit") || text.includes("429")) {
    return "I've hit the AI plan's rate limit. Give it a minute and send that again.";
  }
  if (text.includes(NO_ACCESS) || text.includes("restrictedmodels")) {
    return "The AI plan won't serve the model I'm set up to use. That needs fixing in the app's settings — I can't work around it from here.";
  }
  if (text.includes("quota") || text.includes("insufficient")) {
    return "The AI plan is out of credit. Nothing I send will get through until that's topped up.";
  }

  // Anything else: the real message, trimmed. Better a stack-flavoured line
  // than a shrug.
  const firstLine = raw.split("\n")[0].trim();
  return firstLine
    ? `Something went wrong on my end: ${firstLine.slice(0, 200)}`
    : "Something went wrong on my end — try again in a moment.";
}
