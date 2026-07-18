"use client";

import { use, useEffect, useMemo, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { useCollection } from "@/hooks/use-collection";
import { projectRef, updateProject, deleteProject } from "@/lib/firestore/projects";
import { tasksQuery, createTask, updateTaskStatus, deleteTask } from "@/lib/firestore/tasks";
import type { Project } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const { data: tasks } = useCollection(useMemo(() => tasksQuery(id), [id]));
  const [newTask, setNewTask] = useState("");

  useEffect(() => {
    return onSnapshot(projectRef(id), (snap) => {
      setProject(snap.exists() ? snap.data() : null);
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!project) {
    return <p className="text-sm text-muted-foreground">Project not found.</p>;
  }

  const handleAddTask = async () => {
    if (!newTask.trim()) return;
    await createTask({ title: newTask.trim(), projectId: id });
    setNewTask("");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {project.description || "No description"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={project.status}
            onValueChange={(status) => void updateProject(id, { status: status as Project["status"] })}
          >
            <SelectTrigger className="w-36 font-mono text-xs uppercase">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="done">Done</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="outline" size="sm">
                  Delete
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete project?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes &quot;{project.name}&quot; and all of its tasks.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    void deleteProject(id);
                    router.push("/projects");
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Tasks</h2>
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
        <div className="flex flex-col gap-2">
          {tasks.length === 0 && (
            <p className="text-sm text-muted-foreground">No tasks yet.</p>
          )}
          {tasks.map((task) => (
            <div
              key={task.id}
              className="glow-border flex items-center justify-between rounded-md border bg-card/40 px-3 py-2"
            >
              <button
                onClick={() =>
                  void updateTaskStatus(id, task.id, task.status === "done" ? "todo" : "done")
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
                  onClick={() => void deleteTask(id, task.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Delete task"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
