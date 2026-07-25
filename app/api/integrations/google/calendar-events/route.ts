import { verifyOwnerIdToken } from "@/lib/firebase/verify-id-token";
import { getGoogleAccessToken } from "@/lib/google/server";
import type { CalendarEvent } from "@/types";

export async function POST(req: Request) {
  const isOwner = await verifyOwnerIdToken(req.headers.get("authorization"));
  if (!isOwner) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { refreshToken }: { refreshToken: string } = await req.json();
  const accessToken = await getGoogleAccessToken(refreshToken);

  const params = new URLSearchParams({
    timeMin: new Date().toISOString(),
    maxResults: "10",
    singleEvents: "true",
    orderBy: "startTime",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    return Response.json({ error: await res.text() }, { status: 400 });
  }

  const data = await res.json();
  const events: CalendarEvent[] = (data.items ?? []).map(
    (item: { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; htmlLink: string }) => ({
      id: item.id,
      summary: item.summary ?? "(no title)",
      start: item.start?.dateTime ?? item.start?.date ?? null,
      end: item.end?.dateTime ?? item.end?.date ?? null,
      htmlLink: item.htmlLink,
    })
  );

  return Response.json({ events });
}
