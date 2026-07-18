"use client";

import { useState } from "react";
import Link from "next/link";
import { useCollection } from "@/hooks/use-collection";
import { projectsQuery, createProject } from "@/lib/firestore/projects";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function ProjectsPage() {
  const { data: projects, loading } = useCollection(projectsQuery());
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await createProject({ name: name.trim(), description: description.trim() });
    setSaving(false);
    setName("");
    setDescription("");
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Projects</h1>
          <p className="text-sm text-muted-foreground">Everything you&apos;re building, tracked independently.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button>New Project</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New project</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="project-name">Name</Label>
                <Input
                  id="project-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Property management platform"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="project-description">Description</Label>
                <Textarea
                  id="project-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this project about?"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => void handleCreate()} disabled={!name.trim() || saving}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : projects.length === 0 ? (
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          No projects yet — create one to get started.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="glow-border h-full border bg-card/60 backdrop-blur-sm transition-colors hover:bg-card/90">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{project.name}</CardTitle>
                    <Badge variant="outline" className="font-mono text-[0.65rem] uppercase">
                      {project.status}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {project.description || "No description"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  {project.progress}% complete
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
