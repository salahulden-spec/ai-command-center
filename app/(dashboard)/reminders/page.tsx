"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useCollection } from "@/hooks/use-collection";
import { remindersQuery, createReminder, markReminderDone, deleteReminder } from "@/lib/firestore/reminders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function RemindersPage() {
  const { data: reminders, loading } = useCollection(remindersQuery());
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [dueAt, setDueAt] = useState("");

  const handleCreate = async () => {
    if (!text.trim() || !dueAt) return;
    await createReminder({ text: text.trim(), dueAt: new Date(dueAt) });
    setText("");
    setDueAt("");
    setOpen(false);
  };

  const pending = reminders.filter((r) => r.status === "pending");
  const done = reminders.filter((r) => r.status === "done");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Reminders</h1>
          <p className="text-sm text-muted-foreground">Things to do at a specific time.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button>New Reminder</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New reminder</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="reminder-text">Remind me to</Label>
                <Input id="reminder-text" value={text} onChange={(e) => setText(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="reminder-due">When</Label>
                <Input
                  id="reminder-due"
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => void handleCreate()} disabled={!text.trim() || !dueAt}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            {pending.length === 0 && (
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Nothing pending.
              </p>
            )}
            {pending.map((reminder) => (
              <div
                key={reminder.id}
                className="glow-border flex items-center justify-between rounded-md border bg-card/40 px-3 py-2"
              >
                <div className="flex flex-col">
                  <span className="text-sm">{reminder.text}</span>
                  <span className="font-mono text-[0.65rem] text-muted-foreground">
                    {reminder.dueAt.toDate().toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => void markReminderDone(reminder.id)}>
                    Done
                  </Button>
                  <button
                    onClick={() => void deleteReminder(reminder.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {done.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
                Done
              </h2>
              {done.map((reminder) => (
                <div
                  key={reminder.id}
                  className={cn(
                    "flex items-center justify-between rounded-md border border-border/40 px-3 py-2 text-muted-foreground"
                  )}
                >
                  <span className="text-sm line-through">{reminder.text}</span>
                  <button
                    onClick={() => void deleteReminder(reminder.id)}
                    className="hover:text-destructive"
                    aria-label="Delete"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
