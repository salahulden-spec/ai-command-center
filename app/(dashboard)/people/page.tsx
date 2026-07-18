"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useCollection } from "@/hooks/use-collection";
import { peopleQuery, createPerson, deletePerson } from "@/lib/firestore/people";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function PeoplePage() {
  const { data: people, loading } = useCollection(useMemo(() => peopleQuery(), []));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) return;
    await createPerson({ name: name.trim(), company: company.trim(), notes: notes.trim() });
    setName("");
    setCompany("");
    setNotes("");
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">People</h1>
          <p className="text-sm text-muted-foreground">Contacts tied to your work.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button>New Person</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New person</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="person-name">Name</Label>
                <Input id="person-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="person-company">Company</Label>
                <Input id="person-company" value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="person-notes">Notes</Label>
                <Textarea id="person-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => void handleCreate()} disabled={!name.trim()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : people.length === 0 ? (
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          No people yet.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((person) => (
            <Card key={person.id} className="glow-border border bg-card/90">
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <CardTitle className="text-base">{person.name}</CardTitle>
                <button
                  onClick={() => void deletePerson(person.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Delete person"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
                {person.company && <span>{person.company}</span>}
                {person.notes && <span>{person.notes}</span>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
