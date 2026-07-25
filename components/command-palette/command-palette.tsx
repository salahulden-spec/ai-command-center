"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { PRIMARY_NAV, SECONDARY_NAV } from "@/components/dashboard/nav-links";
import { listProjectsOnce } from "@/lib/firestore/projects";
import { listOpenTasksOnce } from "@/lib/firestore/tasks";
import { listPendingRemindersOnce } from "@/lib/firestore/reminders";
import { listPeopleOnce } from "@/lib/firestore/people";
import { Sparkles } from "lucide-react";
import type { Project, Task, Reminder, Person } from "@/types";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  // Data only needs to be reasonably fresh for a search popover, and
  // refetching on every open (rather than subscribing permanently) avoids
  // holding four extra live Firestore listeners open for the whole session.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    void listProjectsOnce().then(setProjects);
    void listOpenTasksOnce().then(setTasks);
    void listPendingRemindersOnce().then(setReminders);
    void listPeopleOnce().then(setPeople);
  }, [open]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const askAi = () => {
    const q = search.trim();
    if (!q) return;
    onOpenChange(false);
    router.push(`/chat?q=${encodeURIComponent(q)}`);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command shouldFilter>
        <CommandInput
          placeholder="Search or ask anything..."
          value={search}
          onValueChange={setSearch}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) askAi();
          }}
        />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>

          {search.trim() && (
            <>
              <CommandGroup heading="Ask AI">
                <CommandItem value={`ask-ai ${search}`} onSelect={askAi}>
                  <Sparkles className="h-4 w-4" />
                  Ask: &ldquo;{search}&rdquo;
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          <CommandGroup heading="Go to">
            {[...PRIMARY_NAV, ...SECONDARY_NAV].map((link) => (
              <CommandItem key={link.href} value={link.label} onSelect={() => go(link.href)}>
                <link.icon className="h-4 w-4" />
                {link.label}
              </CommandItem>
            ))}
          </CommandGroup>

          {projects.length > 0 && (
            <CommandGroup heading="Projects">
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`project ${project.name}`}
                  onSelect={() => go(`/projects/${project.id}`)}
                >
                  {project.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {tasks.length > 0 && (
            <CommandGroup heading="Tasks">
              {tasks.map((task) => (
                <CommandItem
                  key={task.id}
                  value={`task ${task.title}`}
                  onSelect={() => go(task.projectId ? `/projects/${task.projectId}` : "/tasks")}
                >
                  {task.title}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {people.length > 0 && (
            <CommandGroup heading="People">
              {people.map((person) => (
                <CommandItem
                  key={person.id}
                  value={`person ${person.name} ${person.company}`}
                  onSelect={() => go("/people")}
                >
                  {person.name}
                  {person.company ? ` — ${person.company}` : ""}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {reminders.length > 0 && (
            <CommandGroup heading="Reminders">
              {reminders.map((reminder) => (
                <CommandItem
                  key={reminder.id}
                  value={`reminder ${reminder.text}`}
                  onSelect={() => go("/reminders")}
                >
                  {reminder.text}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
