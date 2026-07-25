"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onSnapshot } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase/client";
import { userSettingsRef, setAiMode } from "@/lib/firestore/user-settings";
import {
  saveGoogleIntegration,
  disconnectGoogle,
  getGoogleIntegrationOnce,
} from "@/lib/firestore/integrations";
import { buildGoogleAuthUrl, googleRedirectUri } from "@/lib/google/oauth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/alert-dialog";
import { exportAllData, downloadBackup } from "@/lib/backup/export";
import { parseBackupFile, summarizeBackup, importBackup, type BackupFile } from "@/lib/backup/import";
import type { AiMode } from "@/types";

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [aiMode, setLocalAiMode] = useState<AiMode>("ask");
  const [exporting, setExporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const googleConfigured = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(userSettingsRef(user.uid), (snap) => {
      setLocalAiMode(snap.data()?.aiMode ?? "ask");
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void getGoogleIntegrationOnce(user.uid).then((integration) => setGoogleConnected(!!integration));
  }, [user]);

  // Google redirects back here with ?code=... after the user grants consent.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code || !user) return;
    router.replace("/settings", { scroll: false });
    setGoogleBusy(true);
    setGoogleError(null);
    (async () => {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/integrations/google/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code, redirectUri: googleRedirectUri() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGoogleError(data.error ?? "Couldn't connect Google — try again.");
        return;
      }
      await saveGoogleIntegration(user.uid, data.refreshToken, data.scope);
      setGoogleConnected(true);
    })()
      .catch(() => setGoogleError("Couldn't connect Google — try again."))
      .finally(() => setGoogleBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleDisconnectGoogle = async () => {
    if (!user) return;
    setGoogleBusy(true);
    try {
      await disconnectGoogle(user.uid);
      setGoogleConnected(false);
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      downloadBackup(await exportAllData());
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    setImportResult(null);
    try {
      const text = await file.text();
      setPendingImport(parseBackupFile(text));
    } catch {
      setImportError("Couldn't read that file — make sure it's a backup exported from this app.");
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImport) return;
    setImporting(true);
    try {
      const count = await importBackup(pendingImport);
      setImportResult(`Restored ${count} record${count === 1 ? "" : "s"}.`);
    } catch {
      setImportError("Import failed partway through — some records may have been restored already.");
    } finally {
      setImporting(false);
      setPendingImport(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
          <CardTitle className="text-base">Backup &amp; Restore</CardTitle>
          <CardDescription>
            Export everything as a single JSON file, or restore from a previous export. Importing
            only adds records — it never overwrites or deletes anything already here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={exporting} onClick={() => void handleExport()}>
              {exporting ? "Exporting..." : "Export all data"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              Import backup
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => void handleFileSelected(e.target.files?.[0])}
            />
          </div>
          {importError && <p className="text-sm text-destructive">{importError}</p>}
          {importResult && <p className="text-sm text-muted-foreground">{importResult}</p>}
        </CardContent>
      </Card>

      <AlertDialog open={pendingImport !== null} onOpenChange={(open) => !open && setPendingImport(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This adds the following as new records. Nothing existing will be changed or removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {pendingImport &&
              summarizeBackup(pendingImport).map((entry) => (
                <li key={entry.label}>
                  {entry.count} — {entry.label}
                </li>
              ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={importing} onClick={() => void handleConfirmImport()}>
              {importing ? "Importing..." : "Import"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="glow-border max-w-lg border bg-card/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-base">Integrations</CardTitle>
          <CardDescription>
            Read-only access to your Calendar and Gmail — nothing is ever created, sent, or
            modified on your behalf.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!googleConfigured ? (
            <p className="text-sm text-muted-foreground">
              Not set up yet — needs Google OAuth credentials in the environment first.
            </p>
          ) : googleConnected ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-primary">Google connected</span>
              <Button
                variant="outline"
                size="sm"
                disabled={googleBusy}
                onClick={() => void handleDisconnectGoogle()}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={googleBusy || googleConnected === null}
              onClick={() => {
                window.location.href = buildGoogleAuthUrl(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!);
              }}
            >
              {googleBusy ? "Connecting..." : "Connect Google Calendar & Gmail"}
            </Button>
          )}
          {googleError && <p className="text-sm text-destructive">{googleError}</p>}
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
