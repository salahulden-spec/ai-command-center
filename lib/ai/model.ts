/**
 * Which model the assistant runs on.
 *
 * It used to be `anthropic/claude-sonnet-4.6`, written out at five separate
 * call sites. The AI Gateway account is on the free tier, which serves no
 * Anthropic model at all — not Sonnet, not Haiku — so every one of those five
 * returned 403 and the whole assistant was dead: chat, Telegram, document
 * analysis and both briefings. Naming it once means the next switch is one
 * line rather than a hunt.
 *
 * Gemini 2.5 Flash is what the free tier will actually serve. It is a real
 * downgrade for the parts of this app that lean hardest on the model —
 * multi-step tool calling, and the strategy/decision answers with their
 * options-and-tradeoffs structure. If those start feeling thin, that is why,
 * and topping up the gateway and putting `anthropic/claude-sonnet-4.6` back
 * here is the whole fix.
 *
 * Embeddings are unaffected: `openai/text-embedding-3-small` is rate-limited
 * on the free tier rather than blocked, so memory search still works.
 *
 * Keep in step with `MODEL` in functions/src/index.ts — Cloud Functions is a
 * separate package and cannot import this one.
 */
export const ASSISTANT_MODEL = "google/gemini-2.5-flash";
