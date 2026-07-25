import { Timestamp } from "firebase/firestore";

/** Wrapper marker so a round-tripped Firestore Timestamp can be told apart from a plain object on import. */
interface SerializedTimestamp {
  __ts: string;
}

function isSerializedTimestamp(value: unknown): value is SerializedTimestamp {
  return (
    typeof value === "object" &&
    value !== null &&
    "__ts" in value &&
    typeof (value as Record<string, unknown>).__ts === "string"
  );
}

export function serializeValue(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return { __ts: value.toDate().toISOString() } satisfies SerializedTimestamp;
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, serializeValue(v)])
    );
  }
  return value;
}

export function deserializeValue(value: unknown): unknown {
  if (isSerializedTimestamp(value)) {
    return Timestamp.fromDate(new Date(value.__ts));
  }
  if (Array.isArray(value)) {
    return value.map(deserializeValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, deserializeValue(v)])
    );
  }
  return value;
}
