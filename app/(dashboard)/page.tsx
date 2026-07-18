"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Signed in</CardTitle>
        <CardDescription>{user?.email}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Today&apos;s Command Center, projects, and chat land in the next phases.
      </CardContent>
    </Card>
  );
}
