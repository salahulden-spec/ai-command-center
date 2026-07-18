"use client";

import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { userSettingsRef, setAiMode } from "@/lib/firestore/user-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AiMode } from "@/types";

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const [aiMode, setLocalAiMode] = useState<AiMode>("ask");

  useEffect(() => {
    if (!user) return;
    return onSnapshot(userSettingsRef(user.uid), (snap) => {
      setLocalAiMode(snap.data()?.aiMode ?? "ask");
    });
  }, [user]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Settings</h1>
        <p className="text-sm text-muted-foreground">Preferences and account.</p>
      </div>

      <Card className="glow-border max-w-lg border bg-card/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-base">AI Permission Mode</CardTitle>
          <CardDescription>
            Controls whether the assistant asks before creating or changing things, or acts
            immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={aiMode}
            onValueChange={(mode) => user && void setAiMode(user.uid, mode as AiMode)}
          >
            <SelectTrigger className="w-56 font-mono text-xs uppercase">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ask">Ask before acting</SelectItem>
              <SelectItem value="execute">Auto-execute</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="glow-border max-w-lg border bg-card/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription className="font-mono">{user?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <button
            onClick={() => void signOut()}
            className="text-sm text-destructive hover:underline"
          >
            Sign out
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
