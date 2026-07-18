"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <Card className="glow-border max-w-lg border bg-card/60 backdrop-blur-sm">
      <CardHeader>
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
          Session active
        </div>
        <CardTitle>Signed in</CardTitle>
        <CardDescription className="font-mono">{user?.email}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Today&apos;s Command Center, projects, and chat land in the next phases.
      </CardContent>
    </Card>
  );
}
