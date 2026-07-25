import { verifyOwnerIdToken } from "@/lib/firebase/verify-id-token";
import { getGoogleAccessToken } from "@/lib/google/server";
import type { GmailMessage } from "@/types";

function headerValue(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function POST(req: Request) {
  const isOwner = await verifyOwnerIdToken(req.headers.get("authorization"));
  if (!isOwner) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { refreshToken }: { refreshToken: string } = await req.json();
  const accessToken = await getGoogleAccessToken(refreshToken);
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&labelIds=INBOX",
    { headers: authHeader }
  );
  if (!listRes.ok) {
    return Response.json({ error: await listRes.text() }, { status: 400 });
  }
  const list = await listRes.json();
  const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);

  const messages: GmailMessage[] = await Promise.all(
    ids.map(async (id) => {
      const params = new URLSearchParams({
        format: "metadata",
        metadataHeaders: "Subject",
      });
      params.append("metadataHeaders", "From");
      params.append("metadataHeaders", "Date");
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?${params.toString()}`,
        { headers: authHeader }
      );
      const data = await res.json();
      const headers = data.payload?.headers ?? [];
      const dateHeader = headerValue(headers, "Date");
      return {
        id,
        subject: headerValue(headers, "Subject") || "(no subject)",
        from: headerValue(headers, "From"),
        snippet: data.snippet ?? "",
        receivedAt: dateHeader ? new Date(dateHeader).toISOString() : null,
      };
    })
  );

  return Response.json({ messages });
}
