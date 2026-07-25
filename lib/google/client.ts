import { auth } from "@/lib/firebase/client";
import type { CalendarEvent, GmailMessage } from "@/types";

async function callIntegrationRoute<T>(path: string, refreshToken: string): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchCalendarEvents(refreshToken: string): Promise<CalendarEvent[]> {
  const { events } = await callIntegrationRoute<{ events: CalendarEvent[] }>(
    "/api/integrations/google/calendar-events",
    refreshToken
  );
  return events;
}

export async function fetchGmailMessages(refreshToken: string): Promise<GmailMessage[]> {
  const { messages } = await callIntegrationRoute<{ messages: GmailMessage[] }>(
    "/api/integrations/google/gmail-messages",
    refreshToken
  );
  return messages;
}
