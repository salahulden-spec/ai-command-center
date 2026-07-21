"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { useCollection } from "@/hooks/use-collection";
import { workflowsQuery, setWorkflowEnabled, deleteWorkflow } from "@/lib/firestore/workflows";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkflowStep } from "@/types";

function describeStep(step: WorkflowStep): string {
  if (step.type === "createTask") return `Create task "${step.title}"`;
  return `Remind: "${step.text}" (${step.delayMinutes}m after trigger)`;
}

export default function AutomationsPage() {
  const { data: workflows, loading } = useCollection(useMemo(() => workflowsQuery(), []));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Automations</h1>
        <p className="text-sm text-muted-foreground">
          Standing workflows that run automatically. Create one by describing it to the assistant
          in Chat — new workflows start disabled, enable here once you've reviewed them.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="flex flex-col gap-2">
          {workflows.length === 0 && (
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              No automations yet.
            </p>
          )}
          {workflows.map((workflow) => (
            <div
              key={workflow.id}
              className="glow-border flex flex-col gap-2 rounded-md border bg-card/40 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{workflow.name}</p>
                  <Badge
                    variant={workflow.enabled ? "default" : "outline"}
                    className="font-mono text-[0.6rem] uppercase"
                  >
                    {workflow.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={workflow.enabled ? "outline" : "default"}
                    onClick={() => void setWorkflowEnabled(workflow.id, !workflow.enabled)}
                  >
                    {workflow.enabled ? "Disable" : "Enable"}
                  </Button>
                  <button
                    onClick={() => void deleteWorkflow(workflow.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete automation"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="font-mono text-[0.65rem] text-muted-foreground">
                WHEN a task&apos;s status changes to &quot;{workflow.trigger.toStatus}&quot;
              </p>
              <div className="flex flex-col gap-1">
                {workflow.steps.map((step, i) => (
                  <p key={i} className="text-sm text-muted-foreground">
                    → {describeStep(step)}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
