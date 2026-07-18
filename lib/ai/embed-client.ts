import { auth } from "@/lib/firebase/client";

export async function embedText(text: string): Promise<number[]> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/embed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Failed to embed text: ${res.status}`);
  }
  const { embedding } = (await res.json()) as { embedding: number[] };
  return embedding;
}
