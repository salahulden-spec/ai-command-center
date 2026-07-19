import { auth } from "@/lib/firebase/client";
import type { DocumentEntities } from "@/types";

type AnalyzeResult = { summary: string; entities: DocumentEntities };

async function callAnalyze(body: Record<string, string>): Promise<AnalyzeResult> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/documents/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Failed to analyze document: ${res.status}`);
  }
  return res.json();
}

export function analyzeText(text: string): Promise<AnalyzeResult> {
  return callAnalyze({ text });
}

export function analyzeFileUrl(fileUrl: string, mediaType: string): Promise<AnalyzeResult> {
  return callAnalyze({ fileUrl, mediaType });
}
