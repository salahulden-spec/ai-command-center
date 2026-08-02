import {
  collection,
  doc,
  deleteDoc,
  serverTimestamp,
  setDoc,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { EntityLink, LinkEntityType } from "@/types";

const converter = makeConverter<EntityLink>();

export function linksQuery() {
  return query(collection(db, "links").withConverter(converter));
}

/**
 * Deterministic id for a relationship, direction-insensitive.
 *
 * The same connection is discovered from many angles — the assistant links
 * Ahmed to a task while creating it, then relinks him a week later when he's
 * mentioned again, and the approval path may replay the same payload. Deriving
 * the doc id from the sorted endpoints makes every one of those writes land on
 * the same document, so "never duplicate" holds by construction instead of by
 * remembering to check first.
 */
export function linkIdFor(
  aType: LinkEntityType,
  aId: string,
  bType: LinkEntityType,
  bId: string
): string {
  const a = `${aType}_${aId}`;
  const b = `${bType}_${bId}`;
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

export async function createLink(
  sourceType: LinkEntityType,
  sourceId: string,
  targetType: LinkEntityType,
  targetId: string
) {
  if (sourceType === targetType && sourceId === targetId) return;
  return setDoc(doc(db, "links", linkIdFor(sourceType, sourceId, targetType, targetId)), {
    sourceType,
    sourceId,
    targetType,
    targetId,
    createdAt: serverTimestamp(),
  });
}

export async function deleteLink(linkId: string) {
  return deleteDoc(doc(db, "links", linkId));
}
