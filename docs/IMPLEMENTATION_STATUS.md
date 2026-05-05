# Implementation Status

Last updated: 2026-05-05

This document compares the current implementation against the working plan for the personal Vercel + Neon deployment.

## Plan vs State

| Area | Target plan | Current state | Remaining gap |
| --- | --- | --- | --- |
| Backend stack | Neon Postgres + Drizzle + Better Auth + SvelteKit API layer. Keep Rust out unless a worker becomes necessary. | Implemented with SvelteKit API routes, Drizzle schema/migrations, Better Auth passkey, Neon-ready config, health checks, and manual migration flow. | Rust remains intentionally deferred. Add it only for heavy background jobs such as calendar workers, recurring expansion, bulk validation, or notification scheduling. |
| Auth and passkeys | Personal allowlist, passkey-first login, recovery path, device-friendly naming. | Email-code onboarding, allowlisted registration emails, passkey login, recovery codes, passkey list/rename/delete, and host/RP health checks are implemented. | Apple passkey picker may keep old cached names. Custom email domain should replace Resend sandbox sender if both allowed emails need independent delivery. |
| Task core | Kanban with hierarchy, checklist, filters, import/export, server sync, and ergonomic schedule input. | Kanban, task hierarchy, checklist, filters, JSON import/export, server CRUD, checklist CRUD, cascade delete, optimistic writes, offline queue, and a reusable visual date-range picker for task creation/detail editing are implemented. Partial task response merge now preserves parent links during checklist sync. Task update/delete conflicts now offer apply-local or keep-server actions. | Checklist/import conflicts are still conservative and report-first. |
| Views | Kanban and Gantt first; add planning views as needed. | Kanban, Gantt centered on today, Gantt read-only checklist previews from the task list, and Eisenhower matrix are implemented. Matrix hides completed tasks by default with an opt-in toggle. The last selected view is persisted per account in `boards.default_view`; `localStorage` remains the offline fallback. | Verify cross-device default view behavior after the next production deploy. Consider Gantt checklist completion toggles only if the read-only preview feels too limited. |
| Calendar | iCal first, Google Calendar as the first external provider, Microsoft optional. | Per-task `.ics`, authenticated `/api/calendar.ics`, revocable iCal subscription links, Google/Microsoft OAuth connection scaffolding, OAuth callback error UX, manual provider sync, secured Vercel Cron endpoint, `CRON_SECRET` Production env, sync logs, full task date range, provider deletion for completed tasks, duplicate event-link protection, and manual Vercel Cron invocation returning `200` are implemented. | Google OAuth is currently blocked by Testing-mode access control until the sync Google account is added under Test users or the OAuth app is moved to In production. Confirm the next scheduled Vercel Cron run appears in runtime logs after 06:00 KST. Provider webhooks, recurring events, and richer provider conflict handling remain future work. |
| Offline/PWA | App should install on Mac/Windows/iPhone/iPad and remain usable after a prior login while offline. | Manifest, maskable/Apple icons, service worker shell cache, iOS safe areas, touch CSS, refresh control, offline auth scope, user-scoped local cache, retryable offline queue, offline import queue, conflict export/actions, iPhone/iPad viewport E2E coverage, Xcode Simulator locked-screen smoke for iPhone 14 Pro and iPad Pro 12.9, and first-pass mobile CSS polish are implemented. | Physical real-device visual smoke is still needed on iPhone 14 Pro, iPad Pro 12.9, Mac, and Windows. Native wrappers are deferred until browser/PWA limits become real blockers. |
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
- Multi-device task update/delete conflicts surface as reviewable dropped mutations with apply-local and keep-server actions.
- Checklist and import conflicts still surface as reviewable reports because automatic replay can be unsafe without field-level context.

## Recommended Next Order

1. Real-device smoke: Mac, Windows, iPhone 14 Pro, iPad Pro 12.9. Cover nested task + checklist sync, matrix completed toggle, offline reload, refresh, installed PWA icon refresh, and cross-device default view persistence.
2. Google OAuth setup: add `scyea1995@gmail.com` as a Google OAuth Test user, then run the production Google Calendar smoke: connect OAuth, sync, mark a synced task done, sync again, confirm provider deletion.
3. Confirm the next scheduled Vercel Cron run appears under runtime/Cron logs; manual cron invocation already returns `200`.
4. Keep checklist/import conflicts report-first unless real conflicts make the extra complexity worthwhile.
5. Add provider webhooks and recurring calendar events.
6. Consider direct Gantt checklist completion toggles only after the read-only preview is validated in daily use.

## Deferred Decisions

- Native iOS/iPadOS wrapper: defer until PWA install, offline shell, notifications, or share sheet constraints become concrete.
- Windows desktop wrapper: keep PWA first; consider Tauri only for desktop-native file/system integration.
- Rust backend/worker: defer until a separate heavy job class exists.
- Custom domain/email: `todokanban-alpha.vercel.app` is acceptable now. A custom domain is useful later for cleaner passkey identity and production email sender reputation.
