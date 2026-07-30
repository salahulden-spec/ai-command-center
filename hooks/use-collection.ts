"use client";

import { useEffect, useState } from "react";
import { onSnapshot, type Query } from "firebase/firestore";

const EMPTY: never[] = [];

/**
 * `query` must be a stable reference (wrap the query() call in useMemo at
 * the call site) — a fresh Query object every render re-triggers this
 * effect, tearing down and re-establishing the Firestore listener on
 * every render.
 *
 * The snapshot is stored together with the query it came from, so `loading`
 * and `data` are derived during render rather than reset inside the effect.
 * That means switching queries never briefly serves the previous query's rows.
 */
export function useCollection<T>(query: Query<T> | null) {
  const [snapshot, setSnapshot] = useState<{ query: Query<T> | null; data: T[] }>({
    query: null,
    data: EMPTY,
  });

  useEffect(() => {
    if (!query) return;
    const unsubscribe = onSnapshot(query, (result) => {
      setSnapshot({ query, data: result.docs.map((doc) => doc.data()) });
    });
    return unsubscribe;
  }, [query]);

  const isCurrent = snapshot.query === query;
  return {
    data: isCurrent ? snapshot.data : EMPTY,
    loading: query !== null && !isCurrent,
  };
}
