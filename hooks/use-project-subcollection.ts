"use client";

import { useEffect, useState } from "react";
import { collectionGroup, onSnapshot, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { ProjectScoped } from "@/lib/mind/graph";

type SubcollectionName = "documents" | "research" | "decisions";

/**
 * Reads a project subcollection across every project at once.
 *
 * `useCollection` can't be used here: its converter hands back only the document
 * data, but the graph needs to know which project each row came from. A
 * collection-group snapshot exposes that via `ref.parent.parent.id`, so this
 * hook keeps the raw snapshot and pairs each row with its parent id.
 *
 * No `orderBy` — an ordered collection-group query would need a composite index
 * per subcollection, and the graph has no use for ordering anyway.
 */
export function useProjectSubcollection<T>(name: SubcollectionName) {
  const [data, setData] = useState<ProjectScoped<T>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collectionGroup(db, name)),
      (snapshot) => {
        setData(
          snapshot.docs
            .map((docSnap) => ({
              id: docSnap.id,
              projectId: docSnap.ref.parent.parent?.id ?? "",
              data: docSnap.data() as T,
            }))
            .filter((row) => row.projectId !== "")
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsubscribe;
  }, [name]);

  return { data, loading };
}
