"use client";

import { useEffect, useState } from "react";
import { onSnapshot, type Query } from "firebase/firestore";

/**
 * `query` must be a stable reference (wrap the query() call in useMemo at
 * the call site) — a fresh Query object every render re-triggers this
 * effect, tearing down and re-establishing the Firestore listener on
 * every render.
 */
export function useCollection<T>(query: Query<T> | null) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!query) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = onSnapshot(query, (snapshot) => {
      setData(snapshot.docs.map((doc) => doc.data()));
      setLoading(false);
    });
    return unsubscribe;
  }, [query]);

  return { data, loading };
}
