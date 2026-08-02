"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FolderKanban,
  ListChecks,
  Users,
  Inbox as InboxIcon,
  Bell,
  Mic,
  ArrowUp,
  MessageCircle,
  Calendar,
  Mail,
  Sparkles,
} from "lucide-react";
import { buildSuggestions } from "@/lib/insights/suggestions";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { projectsQuery } from "@/lib/firestore/projects";
import { allTasksQuery } from "@/lib/firestore/tasks";
import { inboxQuery } from "@/lib/firestore/inbox";
import { remindersQuery } from "@/lib/firestore/reminders";
import { conversationsQuery } from "@/lib/firestore/conversations";
import { getGoogleIntegrationOnce } from "@/lib/firestore/integrations";
import { fetchCalendarEvents, fetchGmailMessages } from "@/lib/google/client";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { AiOrb } from "@/components/dashboard/ai-orb";
import { cn } from "@/lib/utils";
import type { CalendarEvent, GmailMessage } from "@/types";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function countUrgent(
  openTasks: { priority: string; dueDate: { toMillis(): number } | null }[],
  pendingReminders: { dueAt: { toMillis(): number } }[]
): number {
  const now = Date.now();
  return (
    openTasks.filter((t) => t.priority === "high" || (t.dueDate && t.dueDate.toMillis() < now))
      .length + pendingReminders.filter((r) => r.dueAt.toMillis() < now).length
  );
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [input, setInput] = useState("");

  const { data: projects } = useCollection(useMemo(() => projectsQuery(), []));
  const { data: tasks } = useCollection(useMemo(() => allTasksQuery(), []));
  const { data: inbox } = useCollection(useMemo(() => inboxQuery(), []));
  const { data: reminders } = useCollection(useMemo(() => remindersQuery(), []));
  const { data: conversations } = useCollection(useMemo(() => conversationsQuery(), []));

  const activeProjects = projects.filter((p) => p.status === "active");
  const openTasks = tasks.filter((t) => t.status !== "done");
  const unprocessedInbox = inbox.filter((i) => i.status === "unprocessed");
  const pendingReminders = reminders
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.dueAt.toMillis() - b.dueAt.toMillis());
  const todayReminders = pendingReminders.filter((r) => isToday(r.dueAt.toDate()));

  const doneToday = tasks.filter(
    (t) => t.status === "done" && t.updatedAt && isToday(t.updatedAt.toDate())
  );
  const urgentCount = countUrgent(openTasks, pendingReminders);

  const suggestions = useMemo(
    () => buildSuggestions({ projects, tasks, reminders, people: [], inbox, now: new Date() }),
    [projects, tasks, reminders, inbox]
  );

  const totalPending = openTasks.length + pendingReminders.length + unprocessedInbox.length;
  const statusText =
    totalPending === 0
      ? "Everything is under control."
      : `${totalPending} thing${totalPending === 1 ? "" : "s"} need${totalPending === 1 ? "s" : ""} your attention.`;

  const firstName = user?.displayName?.split(" ")[0] || user?.email?.split("@")[0] || "";

  const { supported: micSupported, listening, toggle: toggleMic } = useSpeechRecognition(
    (text) => setInput((prev) => (prev ? `${prev} ${text}` : text))
  );

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [gmailMessages, setGmailMessages] = useState<GmailMessage[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void getGoogleIntegrationOnce(user.uid).then((integration) => {
      if (cancelled || !integration) return;
      void fetchCalendarEvents(integration.refreshToken).then((e) => !cancelled && setEvents(e));
      void fetchGmailMessages(integration.refreshToken).then((m) => !cancelled && setGmailMessages(m));
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    router.push(`/chat?q=${encodeURIComponent(input.trim())}`);
  };

  const quickActions = [
    { href: "/projects", label: "Projects", icon: FolderKanban, count: activeProjects.length },
    { href: "/tasks", label: "Tasks", icon: ListChecks, count: openTasks.length },
    { href: "/people", label: "People", icon: Users, count: null },
    { href: "/inbox", label: "Inbox", icon: InboxIcon, count: unprocessedInbox.length },
    { href: "/reminders", label: "Reminders", icon: Bell, count: pendingReminders.length },
  ];

  return (
    <div className="flex flex-col gap-10 pb-6">
      <div className="text-center md:text-left">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
          {new Date().toLocaleDateString([], {
            weekday: "long",
            month: "short",
            day: "numeric",
          })}
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          {getGreeting()}
          {firstName && `, ${firstName}`}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{statusText}</p>
      </div>

      <div className="flex flex-col items-center gap-6">
        <AiOrb size="lg" />
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          How can I help you today?
        </p>
        <form onSubmit={handleSubmit} className="w-full max-w-2xl">
          <div className="glow-border flex items-center gap-2 rounded-full border bg-card/60 px-3 py-2 backdrop-blur-sm">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything or give an instruction..."
              className="flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            {micSupported && (
              <button
                type="button"
                onClick={toggleMic}
                aria-label="Voice input"
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
                  listening && "glow-text animate-breathe text-primary"
                )}
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>

      {/* Live executive overview: the numbers that describe today at a glance. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Active projects", value: activeProjects.length, href: "/projects" },
          { label: "Open tasks", value: openTasks.length, href: "/tasks" },
          { label: "Done today", value: doneToday.length, href: "/tasks" },
          { label: "Urgent", value: urgentCount, href: "/briefing", alert: urgentCount > 0 },
        ].map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="surface tap flex flex-col gap-1 px-4 py-3 hover:bg-card"
          >
            <span
              className={cn(
                "font-mono text-2xl font-semibold",
                stat.alert ? "text-destructive" : "text-foreground"
              )}
            >
              {stat.value}
            </span>
            <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">
              {stat.label}
            </span>
          </Link>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
              Suggestions
            </h2>
            <Link href="/briefing" className="text-xs text-muted-foreground hover:text-foreground">
              Full briefing
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {suggestions.slice(0, 3).map((s) => (
              <Link
                key={s.id}
                href={s.href}
                className="surface tap flex items-center gap-3 px-4 py-3 text-sm hover:bg-card"
              >
                <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">{s.text}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">
          Quick Actions
        </h2>
        {/* Bleeds to the screen edge on mobile so the row reads as scrollable
            instead of looking like it just happens to be clipped. */}
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                className="surface tap flex min-w-[7.5rem] shrink-0 flex-col items-center gap-2 px-4 py-4 hover:bg-card"
              >
                <Icon className="h-5 w-5 text-primary" />
                <span className="text-xs">{action.label}</span>
                {action.count !== null && action.count > 0 && (
                  <span className="font-mono text-[0.65rem] text-muted-foreground">
                    {action.count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">
          Today&apos;s Focus
        </h2>
        {todayReminders.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled for today.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {todayReminders.map((reminder) => (
              <div
                key={reminder.id}
                className="glow-border flex items-center gap-4 rounded-md border bg-card/40 px-4 py-3"
              >
                <span className="font-mono text-xs text-primary">
                  {reminder.dueAt.toDate().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span className="text-sm">{reminder.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {events.length > 0 && (
        <div>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Upcoming Events
          </h2>
          <div className="flex flex-col gap-2">
            {events.slice(0, 5).map((event) => (
              <a
                key={event.id}
                href={event.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                className="glow-border flex items-center gap-3 rounded-md border bg-card/40 px-4 py-3 transition-colors hover:bg-card/70"
              >
                <Calendar className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm">{event.summary}</span>
                {event.start && (
                  <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">
                    {new Date(event.start).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      {gmailMessages.length > 0 && (
        <div>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Recent Emails
          </h2>
          <div className="flex flex-col gap-2">
            {gmailMessages.map((message) => (
              <div
                key={message.id}
                className="glow-border flex items-center gap-3 rounded-md border bg-card/40 px-4 py-3"
              >
                <Mail className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{message.subject}</p>
                  <p className="truncate text-xs text-muted-foreground">{message.from}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Recent Conversations
          </h2>
          <Link href="/chat" className="text-xs text-muted-foreground hover:text-foreground">
            View all
          </Link>
        </div>
        {conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No conversations yet — ask the assistant something above to get started.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {conversations.slice(0, 5).map((conversation) => (
              <Link
                key={conversation.id}
                href={`/chat?id=${conversation.id}`}
                className="glow-border flex items-center gap-3 rounded-md border bg-card/40 px-4 py-3 transition-colors hover:bg-card/70"
              >
                <MessageCircle className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{conversation.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {conversation.lastMessagePreview}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">
                  {formatRelativeTime(conversation.updatedAt.toDate())}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
