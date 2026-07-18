import type { FirestoreDataConverter, QueryDocumentSnapshot } from "firebase/firestore";

export function makeConverter<T extends { id: string }>(): FirestoreDataConverter<T> {
  return {
    toFirestore(data: T) {
      const { id: _id, ...rest } = data;
      return rest;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot) {
      return { id: snapshot.id, ...snapshot.data() } as T;
    },
  };
}
