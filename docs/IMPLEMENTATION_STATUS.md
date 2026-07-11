# Implementation Status

Last updated: 2026-07-11

This document compares the current implementation against the working plan for the personal Vercel + Neon deployment.

## Production Snapshot

- Latest production merges (2026-07-06 ~ 07-11): #54 offline-sync race-condition fixes, #55 dependency security update (`npm audit` 0), #56 server write-path hardening (atomic batches, recursive-CTE cascade delete, partial PATCH, per-user rate limits), #57 Playwright E2E in CI on Chromium + iPhone WebKit, plus Dependabot action bumps.
- Latest strict health smoke: `https://todokanban-alpha.vercel.app/api/health?strict=true` returned `ok: true` on 2026-07-11, verified after each of the four production deploys.
- Category entity v2 migration (0010) is confirmed applied in production (the board list join requires it and daily usage works).
- Passkey login manually confirmed on-device after the better-auth 1.6.23 bump (2026-07-11).
- Calendar direction: `.ics` is the active product path. The whole-board `.ics` link was manually confirmed, and Google/Microsoft provider sync is deferred behind existing route/service scaffolding. The unused local Google OAuth client credential file has been deleted; deleting the OAuth client in Google Cloud Console remains a pending manual step.

## Plan vs State

| Area | Target plan | Current state | Remaining gap |
| --- | --- | --- | --- |
| Backend stack | Neon Postgres + Drizzle + Better Auth + SvelteKit API layer. Keep Rust out unless a worker becomes necessary. | Implemented with SvelteKit API routes, Drizzle schema/migrations, Better Auth passkey, Neon-ready config, health checks, and manual migration flow. | Rust remains intentionally deferred. Add it only for heavy background jobs such as calendar workers, recurring expansion, bulk validation, or notification scheduling. |
| Auth and passkeys | Personal allowlist, passkey-first login, recovery path, device-friendly naming. | Email-code onboarding, allowlisted registration emails, passkey login, recovery codes, passkey list/rename/delete, and host/RP health checks are implemented. | Apple passkey picker may keep old cached names. Custom email domain should replace Resend sandbox sender if both allowed emails need independent delivery. |
| Task core | Kanban with hierarchy, checklist, filters, import/export, server sync, category management, and ergonomic schedule input. | Kanban, task hierarchy, checklist, filters, DB-backed category entity v2, category rename/merge/delete, category colors, sorting, hide/archive, category counts, rule-based category suggestions while adding/editing tasks, JSON import/export, server CRUD, checklist CRUD, cascade delete, optimistic writes, offline queue, and a reusable visual date-range picker for task creation/detail editing are implemented on the current branch. Partial task response merge now preserves parent links during checklist sync. Task update/delete conflicts now offer apply-local or keep-server actions. | Category v2 requires the new Drizzle migration before production deploy. Checklist/import conflicts are still conservative and report-first. LLM-based category automation remains deferred until the manual taxonomy feels stable. |
| Views | Kanban and Gantt first; add planning views as needed. | Kanban, Gantt centered on today, Gantt task-list checklist previews with completion toggles, and Eisenhower matrix are implemented. Matrix hides completed tasks by default with an opt-in toggle. The last selected view is persisted per account in `boards.default_view`; `localStorage` remains the offline fallback. | Verify cross-device default view behavior on physical devices. Watch whether Gantt checklist toggles need an undo affordance after daily use. |
| Calendar | Keep `.ics` as the primary calendar path; defer provider sync unless it becomes necessary. | The visible UI now has one top-level `전체 일정 동기화` control backed by revocable `.ics` secret links with clearer warning text and a 30-day default expiry. Per-task `일정 추가` downloads single-task `.ics` files. Authenticated `/api/calendar.ics` remains available. The whole-board `.ics` link has been manually confirmed. Google/Microsoft OAuth provider scaffolding, cron, and sync logs still exist in code but are hidden from the primary UI. | Validate the `.ics` flow on every target device/calendar app. Google OAuth remains deferred because `.ics` works and the provider flow is blocked by Google OAuth access control. Re-enable provider sync only if `.ics` is not enough. |
| Offline/PWA | App should install on Mac/Windows/iPhone/iPad and remain usable after a prior login while offline. | Manifest, maskable/Apple icons, service worker shell cache, iOS safe areas, touch CSS, refresh control, offline auth scope, user-scoped local cache, retryable offline queue, offline import queue, conflict export/actions, logout-time local cache cleanup, iPhone/iPad viewport E2E coverage, Xcode Simulator locked-screen smoke for iPhone 14 Pro and iPad Pro 12.9, compact mobile header actions, touch-oriented add/detail sheets, Gantt readability polish, and iPad tablet CSS tuning are implemented. | Physical real-device visual smoke is still needed on iPhone 14 Pro, iPad Pro 12.9, Mac, and Windows. Native wrappers are deferred until browser/PWA limits become real blockers. |
| Deployment | Free Vercel app at `todokanban-alpha.vercel.app`, Neon Asia region, manual DB migrations. | Production deploys from `main` through GitHub/Vercel. Strict health checks pass with minimal public output, and detailed health can be protected by `HEALTH_DETAILS_TOKEN`. Vercel functions are pinned to Tokyo. Manual migration runbook exists. | Keep running smoke checks after each production deploy, especially the `.ics` whole-board link and single-task `.ics` download flow. |
| Security and operations | Tight `.gitignore`, generated secrets, env runbooks, no secret commits, public-repo hygiene. | `.env`-style files and local analysis artifacts are ignored, secret generator and production doctor exist, strict health validates required env/passkey origin values and blocks preview email codes in production, OAuth tokens are encrypted at rest, iCal tokens are HMAC-hashed, SvelteKit-owned CSP hashes page bootstrap scripts, fallback API security headers are added, iCal feed `lastUsedAt` writes are throttled, iCal feed requests have coarse IP plus token/IP rate limits, volatile rate-limit buckets are capped, email verification requests use coarse IP limiting plus generic allowlist responses, auth config errors use generic public messages, health detail tokens use timing-safe comparison, logout warns before deleting unsynced offline changes, GitHub secret scanning/push protection are enabled, CI runs `npm audit`, and Dependabot monitors npm/GitHub Actions. | Rotate secrets if any machine or deployment access changes. Keep reviewing dependency PRs and security alerts. |
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

1. Pointer-based drag-and-drop shared across Kanban/Gantt/Eisenhower (touch support — card movement is currently dead on iOS/Android; the Eisenhower matrix has no touch fallback at all). The WebKit iPhone E2E project now in CI is the safety net for this work.
2. Kanban manual ordering: add PATCH support for `tasks.position` (fractional midpoint — the `numeric(20,10)` column and index already exist) plus drop-position indicators.
3. Generalize the sync-notice banner into a toast/undo system so cascade deletes and bulk actions become reversible.
4. Technical hardening batch (one PR): client fetch timeouts + `retry-after` honoring, `rate_limit_buckets` and soft-deleted-task purge on the existing cron, single-JOIN task authorization query.
5. Keep checklist/import conflicts report-first unless real conflicts make the extra complexity worthwhile.

## Deferred Decisions

- Native iOS/iPadOS wrapper: defer until PWA install, offline shell, notifications, or share sheet constraints become concrete.
- Windows desktop wrapper: keep PWA first; consider Tauri only for desktop-native file/system integration.
- Rust backend/worker: defer until a separate heavy job class exists.
- Custom domain/email: `todokanban-alpha.vercel.app` is acceptable now. A custom domain is useful later for cleaner passkey identity and production email sender reputation.
