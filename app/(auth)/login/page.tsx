"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/use-auth";

export default function LoginPage() {
  const { user, loading, isAllowed, signInWithGoogle, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && isAllowed) {
      router.replace("/");
    }
  }, [loading, user, isAllowed, router]);

  const handleSignIn = async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : undefined;
      setError(code ? `Sign-in failed: ${code}` : "Sign-in failed. Please try again.");
    }
  };

  const showDenied = !loading && user && !isAllowed;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>AI Command Center</CardTitle>
          <CardDescription>Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {showDenied && (
            <Alert variant="destructive">
              <AlertTitle>Access denied</AlertTitle>
              <AlertDescription>
                {user?.email} isn&apos;t authorized for this app.
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {showDenied ? (
            <Button variant="outline" onClick={() => void signOut()}>
              Sign out and try a different account
            </Button>
          ) : (
            <Button onClick={() => void handleSignIn()} disabled={loading}>
              Sign in with Google
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
