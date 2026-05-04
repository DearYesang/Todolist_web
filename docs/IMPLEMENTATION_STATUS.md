# Implementation Status

Last updated: 2026-05-04

This document compares the current implementation against the working plan for the personal Vercel + Neon deployment.

## Plan vs State

| Area | Target plan | Current state | Remaining gap |
| --- | --- | --- | --- |
| Backend stack | Neon Postgres + Drizzle + Better Auth + SvelteKit API layer. Keep Rust out unless a worker becomes necessary. | Implemented with SvelteKit API routes, Drizzle schema/migrations, Better Auth passkey, Neon-ready config, health checks, and manual migration flow. | Rust remains intentionally deferred. Add it only for heavy background jobs such as calendar workers, recurring expansion, bulk validation, or notification scheduling. |
| Auth and passkeys | Personal allowlist, passkey-first login, recovery path, device-friendly naming. | Email-code onboarding, allowlisted registration emails, passkey login, recovery codes, passkey list/rename/delete, and host/RP health checks are implemented. | Apple passkey picker may keep old cached names. Custom email domain should replace Resend sandbox sender if both allowed emails need independent delivery. |
| Task core | Kanban with hierarchy, checklist, filters, import/export, server sync. | Kanban, task hierarchy, checklist, filters, JSON import/export, server CRUD, checklist CRUD, cascade delete, optimistic writes, and offline queue are implemented. Partial task response merge now preserves parent links during checklist sync. | Field-level conflict resolution is still conservative. Add explicit apply/keep-server actions for multi-device conflicts. |
| Views | Kanban and Gantt first; add planning views as needed. | Kanban, Gantt centered on today, and Eisenhower matrix are implemented. Matrix hides completed tasks by default with an opt-in toggle. | Persisting the preferred default view is not implemented. DB `boards.default_view` currently allows only `kanban` and `gantt` because it is not used by the UI yet. |
| Calendar | iCal first, Google Calendar as the first external provider, Microsoft optional. | Per-task `.ics`, authenticated `/api/calendar.ics`, revocable iCal subscription links, Google/Microsoft OAuth connection scaffolding, manual provider sync, sync logs, full task date range, and provider deletion for completed tasks are implemented. | Run real Google OAuth smoke with the production account. Background sync, provider webhooks, recurring events, and richer provider conflict handling remain future work. |
| Offline/PWA | App should install on Mac/Windows/iPhone/iPad and remain usable after a prior login while offline. | Manifest, maskable/Apple icons, service worker shell cache, iOS safe areas, touch CSS, refresh control, offline auth scope, user-scoped local cache, retryable offline queue, offline import queue, and conflict export are implemented. | More visual tuning for iPhone 14 Pro and iPad Pro 12.9 is still planned. Native wrappers are deferred until browser/PWA limits become real blockers. |
| Deployment | Free Vercel app at `todokanban-alpha.vercel.app`, Neon Asia region, manual DB migrations. | Production deploys from `main` through GitHub/Vercel. Strict health checks pass. Vercel functions are pinned to Tokyo. Manual migration runbook exists. | Keep running smoke checks after each production deploy. Add a real Google Calendar smoke once OAuth consent is ready. |
| Security and operations | Tight `.gitignore`, generated secrets, env runbooks, no secret commits. | `.env`-style files are ignored, secret generator and production doctor exist, strict health validates required env and passkey origin values, OAuth tokens are encrypted at rest, iCal tokens are HMAC-hashed. | Add periodic dependency/security review and rotate secrets if any machine or deployment access changes. |
| Documentation | README and runbooks should reflect current architecture. | README, deployment checklist, Vercel/Neon plan, schema notes, and migration notes are maintained. This status document is now the plan-vs-state reference. | Keep this file updated after major feature PRs. |

## Architecture Baseline

```txt
Browser / PWA
  -> SvelteKit route shell
  -> App.svelte views: Kanban, Gantt, Eisenhower
  -> client task cache + optimistic mutations
  -> localStorage fallback cache + offline write queue
  -> SvelteKit API routes
  -> Better Auth session/passkey
  -> server task/calendar services
  -> Drizzle
  -> Neon Postgres
```

## Consistency Model

- Server writes are the durable source of truth when online.
- Client writes are optimistic and stored locally first for responsive UI.
- Retryable failed writes are persisted in a user-scoped offline queue.
- Full server snapshots are authoritative for server UUID-backed tasks.
- Partial server responses must be merged into the current full client task graph before graph validation. This prevents valid `parentId` links from being dropped just because the parent task was not included in a one-task response.
- Multi-device conflicts currently surface as reviewable dropped mutations; field-level resolution is planned but not implemented.

## Recommended Next Order

1. Real-device smoke: Mac, Windows, iPhone 14 Pro, iPad Pro 12.9. Cover nested task + checklist sync, matrix completed toggle, offline reload, and refresh.
2. Production Google Calendar smoke: connect OAuth, sync, mark a synced task done, sync again, confirm provider deletion.
3. Conflict UX v2: add apply-local / keep-server actions for conflict rows instead of report-only handling.
4. Mobile CSS polish: tighter header/action layout, matrix card density, Gantt touch ergonomics.
5. Calendar automation: background sync workers and provider webhooks.
6. Default view persistence: store preferred view only after deciding whether `boards.default_view` should include `matrix`.

## Deferred Decisions

- Native iOS/iPadOS wrapper: defer until PWA install, offline shell, notifications, or share sheet constraints become concrete.
- Windows desktop wrapper: keep PWA first; consider Tauri only for desktop-native file/system integration.
- Rust backend/worker: defer until a separate heavy job class exists.
- Custom domain/email: `todokanban-alpha.vercel.app` is acceptable now. A custom domain is useful later for cleaner passkey identity and production email sender reputation.
