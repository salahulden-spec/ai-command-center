import { collection, query, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { Briefing } from "@/types";

const converter = makeConverter<Briefing>();

/** Recent briefings of both types, newest first — the page splits them by `type` client-side. */
export function briefingsQuery(take = 20) {
  return query(
    collection(db, "briefings").withConverter(converter),
    orderBy("createdAt", "desc"),
    limit(take)
  );
}
