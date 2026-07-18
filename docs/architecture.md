# AI Command Center — Architecture, Schema & Roadmap

## Context

You want a private, single-user "Personal AI Operating System" — a second brain that acts as executive assistant, project manager, research analyst, and strategic advisor, driven by natural conversation rather than manual data entry. This is a brand-new project (confirmed: new folder `Desktop/ai-command-center`, separate from the unrelated site-template repo already on your Desktop). Per your instructions, no code gets written until this architecture is approved — this document is that architecture, database schema, folder structure, and phased roadmap.

Three decisions are locked in from your answers:
- **AI layer**: Vercel AI Gateway (one API, native routing/fallback across Claude/GPT/Gemini/Grok, swappable later) instead of a hand-rolled multi-SDK adapter.
- **Accounts**: Firebase and Vercel projects don't exist yet — Phase 0 creates them, with you doing the actual clicks/logins.
- **Auth**: Google Sign-In, server + Firestore-rule locked to your single email.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui | Matches your requested stack; shadcn gives premium Linear/Arc-style components fast |
| Hosting | Vercel (Hobby) | Free tier, zero-config, Fluid Compute, cron support for daily/weekly briefings |
| Database | Firebase Firestore | Free tier, realtime, matches your requested stack, good fit for single-user document data |
| File storage | Firebase Storage | Documents, images, voice captures |
| Auth | Firebase Auth (Google provider), restricted to 1 email | No password management, one click |
| AI access | Vercel AI SDK + AI Gateway | Provider abstraction + routing/fallback built in, per-task model selection via plain `"provider/model"` strings |
| Local/private AI | Ollama, called directly (bypasses gateway) | Keeps "private local tasks" fully offline when desired |
| Embeddings/memory search | Gateway embeddings + Firestore vector search (or client-side cosine sim initially) | Semantic recall without extra infra |
| Config | `vercel.ts` (new typed config format) | Replaces vercel.json |

## High-Level Architecture

```
Browser (PWA, mobile-first)
   │
   ▼
Next.js App Router (UI + Server Actions + /api routes)
   │
   ├─▶ Firestore (all structured data) + Storage (files)
   │
   └─▶ Agent Orchestrator (lib/ai/agents/orchestrator.ts)
          │  reads Permission Mode (Observe/Recommend/Execute/Autonomous)
          │  from users/{uid}.aiMode + per-agent overrides
          ▼
     ┌─────────────┬──────────────┬───────────┬──────────────┬────────────┬─────────────┬──────────────┐
     │  Executive   │   Project    │ Research  │  Strategy    │  Document  │   Memory    │  Automation  │
     │  Assistant   │   Manager    │  Agent    │  Advisor     │   Agent    │   Agent     │    Agent     │
     └─────────────┴──────────────┴───────────┴──────────────┴────────────┴─────────────┴──────────────┘
                                        │
                                        ▼
                          Vercel AI Gateway (model routing + fallback)
                          Claude / GPT / Gemini / Grok  (+ direct Ollama for local)
```

The orchestrator is a single function-calling entrypoint: user message in → intent classification → route to one or more agents → agents call typed Firestore write helpers, never raw writes → every write is gated by the current permission mode before it executes.

**Permission system**: `users/{uid}.aiMode` holds the global default (`observe | recommend | execute | autonomous`). Agents check this (and an optional per-agent override) before any Firestore write. In `observe`/`recommend`, proposed actions are written to a `pendingActions` collection for one-click approval in the UI instead of being applied directly.

**Project independence**: agents only read/write within the project they're explicitly working on. No background job cross-links or merges projects — memory of past projects is retrieved only on explicit request (e.g. "what did we decide on Project X?"), never auto-injected into a new project's context.

## Database Schema (Firestore)

Single-user, so no `orgId`/multi-tenant fields anywhere.

```
users/{uid}
  email, displayName, aiMode, createdAt

projects/{projectId}
  name, description, status (active|blocked|paused|done|archived)
  objectives: string[]
  milestones: { title, dueDate, done }[]
  risks: { text, severity, mitigation }[]
  progress: number (0-100)
  createdAt, updatedAt
  projects/{projectId}/tasks/{taskId}
    title, description, status (todo|doing|blocked|done), priority, dueDate, source (manual|ai)
  projects/{projectId}/research/{researchId}
    title, content, links: string[], tags: string[], createdAt
  projects/{projectId}/documents/{docId}
    storagePath, fileName, extractedSummary, extractedEntities: {dates, people, companies, tasks}
  projects/{projectId}/decisions/{decisionId}
    question, options: {label, pros, cons, cost, time, risk, roi}[], recommended, reasoning, confidence, decidedAt

tasks/{taskId}                 // standalone tasks not tied to a project
reminders/{reminderId}          // text, dueAt, status, relatedProjectId?
inbox/{itemId}                  // type (note|voice|link|screenshot), rawContent, status (unprocessed|organized), organizedInto?
memory/{memoryId}               // type (fact|preference|person|company|decision), content, embedding, relatedProjectId?, source, createdAt
people/{personId}               // name, company, notes, lastContactAt
companies/{companyId}           // name, notes
conversations/{conversationId}
  conversations/{conversationId}/messages/{messageId}
    role, content, agentUsed, modelUsed, createdAt
waitingFor/{itemId}              // who, what, askedAt, followUpAt, status (waiting|received)
timelineEvents/{eventId}         // type, description, relatedId, occurredAt
workflows/{workflowId}           // name, trigger, steps: {type, config}[], enabled
pendingActions/{actionId}        // agent, actionType, payload, createdAt, status (pending|approved|rejected)
settings/global                  // modelRoutingRules, integrationRefs (no raw secrets — those live in Vercel env vars)
```

## Folder Structure

```
ai-command-center/
  app/
    (auth)/login/page.tsx
    (dashboard)/
      page.tsx                 # Today's Command Center
      projects/[id]/page.tsx
      inbox/page.tsx
      knowledge/page.tsx
      waiting-for/page.tsx
      timeline/page.tsx
      chat/page.tsx
    api/
      chat/route.ts            # streaming orchestrator entrypoint
      agents/[agent]/route.ts
      cron/daily-briefing/route.ts
      cron/weekly-review/route.ts
    layout.tsx
  components/
    ui/                        # shadcn primitives
    dashboard/
    chat/
    command-palette/
  lib/
    firebase/{client.ts,admin.ts,converters.ts}
    ai/
      gateway.ts                # AI SDK + Gateway client
      router.ts                 # task -> model selection rules
      agents/
        orchestrator.ts
        executive-assistant.ts
        project-manager.ts
        research.ts
        strategy-advisor.ts
        document.ts
        memory.ts
        automation.ts
    permissions/mode-gate.ts
    firestore/                  # typed collection helpers (one per collection above)
  types/                        # shared TS types mirroring the schema
  hooks/
  public/
  vercel.ts
```

## Development Phases

Each phase ships a working, deployed increment. Nothing starts on the next phase without your sign-off.

1. **Phase 0 — Foundations**: create Firebase project (Auth+Firestore+Storage) and Vercel project (you do the account clicks, I guide + wire config); scaffold Next.js + TS + Tailwind + shadcn; `vercel.ts`; empty deploy live at a `.vercel.app` URL.
2. **Phase 1 — Core Shell**: Google Sign-In gate (single email), app shell (nav, command palette skeleton), one chat screen wired straight to AI Gateway (single model, no agents/memory yet) to prove the AI plumbing end-to-end.
3. **Phase 2 — Data Model + Manual CRUD**: Projects, Tasks, Inbox, Reminders, People screens with manual create/edit; Today's Command Center reads real Firestore data.
4. **Phase 3 — Orchestrator + First Agents**: intent routing, Executive Assistant + Project Manager agents, function-calling to create projects/tasks/reminders from chat, permission-mode gating + `pendingActions` approval UI.
5. **Phase 4 — Memory System**: `memory` collection, embeddings, semantic recall in chat, Memory Agent, explicit (not automatic) cross-project recall.
6. **Phase 5 — Remaining Agents**: Research Agent, Strategy Advisor (decision-options engine), Document Agent (PDF/Word/Excel/image extraction via Storage), Automation Agent (basic trigger→steps workflows).
7. **Phase 6 — Daily Briefing & Weekly Review**: Vercel Cron jobs generating the two scheduled summaries.
8. **Phase 7 — Search, Command Palette, Voice**: Spotlight-style global search, keyboard shortcuts, voice input routed through the same chat pipeline.
9. **Phase 8 — Integrations, Backup, Analytics**: Google Calendar/Gmail as first live integrations, clean interfaces stubbed for the rest, export/import backup, private productivity analytics.

## What I will and won't do autonomously

- I'll scaffold code, write Firestore rules, wire the Gateway, and deploy preview builds without asking each time.
- I will **not** create your Firebase/GitHub/Vercel accounts or click "New Project" myself — those require your login; I'll tell you exactly what to click and take it from there once it exists.
- I will **not** enter API keys/credentials into any form — you paste those into Vercel env vars or Firebase console yourself; I'll tell you exactly which value goes where.
- I will **not** enable Autonomous-mode workflows or push to a public repo without asking first at that specific moment.

## Verification per phase

- Local: run the dev server via the Browser pane (`preview_start`), click through the new screens.
- Deployed: `vercel deploy` preview URL, sanity-check in the Browser pane.
- Data: inspect Firestore console (read-only) to confirm documents match the schema above.
