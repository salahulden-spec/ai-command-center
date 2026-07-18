"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useCollection } from "@/hooks/use-collection";
import { tasksQuery, createTask, updateTaskStatus, deleteTask } from "@/lib/firestore/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function TasksPage() {
  const { data: tasks, loading } = useCollection(useMemo(() => tasksQuery(null), []));
  const [newTask, setNewTask] = useState("");

  const handleAddTask = async () => {
    if (!newTask.trim()) return;
    await createTask({ title: newTask.trim(), projectId: null });
    setNewTask("");
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Standalone tasks not tied to a project. Project tasks live on their project page.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleAddTask()}
          placeholder="Add a task..."
        />
        <Button onClick={() => void handleAddTask()} disabled={!newTask.trim()}>
          Add
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : tasks.length === 0 ? (
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          No standalone tasks.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="glow-border flex items-center justify-between rounded-md border bg-card/40 px-3 py-2"
            >
              <button
                onClick={() =>
                  void updateTaskStatus(null, task.id, task.status === "done" ? "todo" : "done")
                }
                className={cn(
                  "text-sm",
                  task.status === "done" && "text-muted-foreground line-through"
                )}
              >
                {task.title}
              </button>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
                  {task.status}
                </Badge>
                <button
                  onClick={() => void deleteTask(null, task.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Delete task"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
