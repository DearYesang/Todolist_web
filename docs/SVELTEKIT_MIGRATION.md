# SvelteKit Migration Notes

The project has moved from a Svelte 5 + Vite SPA shell to a SvelteKit shell. The current app still uses browser `localStorage` for task data, but it now renders through SvelteKit routes.

## Completed

- `vite.config.js` uses the SvelteKit plugin.
- `svelte.config.js` uses `@sveltejs/adapter-auto`.
- `src/app.html` is the document shell.
- `src/routes/+layout.svelte` imports the global stylesheet and owns document metadata.
- `src/routes/+page.svelte` renders the existing app component.
- Obsolete SPA entry files were removed: `index.html`, `src/main.js`.
- `prepare` runs `svelte-kit sync`.

## Current Shape

```txt
Browser
  -> SvelteKit route shell
  -> existing App.svelte
  -> local task store
  -> browser localStorage
```

## Important Boundary

Pure task validation now lives in `src/lib/shared/task-domain.js`. The writable stores, localStorage persistence, and client actions live in `src/lib/client/task-store.js`.

Components now import directly from `src/lib/client/task-store.js` and `src/lib/shared/task-domain.js`. The temporary `src/store.js` compatibility re-export has been removed.

Neon/Drizzle schema and lazy DB initialization live under `src/lib/server/db`.

Better Auth server configuration lives under `src/lib/server/auth`; the SvelteKit hook mounts auth routes only when `DATABASE_URL` is configured.

PWA install metadata lives in `static/manifest.webmanifest`; `src/service-worker.js` caches the app shell and static assets for repeat visits.

Local iCalendar export uses `src/lib/shared/calendar-ics.js`; the same generator can back a server `.ics` feed once tasks are database-backed.

`src/routes/api/tasks/+server.js` exposes authenticated server read/create paths for database-backed tasks. Client writes still use the local store until the rest of the write and conflict policy is explicit.

## Target Shape

```txt
Browser / PWA
  -> SvelteKit routes and components
  -> client task cache
  -> SvelteKit server routes/actions
  -> Better Auth session
  -> domain services
  -> Drizzle
  -> Neon Postgres
```

## Proposed Structure

```txt
src/lib/components/
src/lib/client/task-store.js
src/lib/shared/task-schema.js
src/lib/shared/task-domain.js
src/lib/server/auth/
src/lib/server/db/
src/lib/server/tasks/
src/hooks.server.js
src/routes/+layout.server.js
src/routes/+page.svelte
src/routes/api/tasks/+server.js
src/routes/api/import/+server.js
src/routes/api/export/+server.js
```

## Next Steps

1. Add SvelteKit route-level smoke tests or Playwright once UI flows stabilize.
2. Build account onboarding UI around passkey registration and sign-in.
3. Implement server task update/delete/checklist writes with an explicit transaction/conflict policy.
4. Switch client mutations from local store writes to server calls with optimistic updates.
5. Keep JSON import/export compatible by mapping legacy `id` and `parentId` values during import.
6. Add server-backed read-only iCalendar feed after task data is server-backed.
7. Define conflict policy for offline server-backed writes.

## Domain Boundaries

The server domain layer should own:

- task creation and updates
- date normalization
- duplicate ID handling during import
- parent graph validation
- cascade delete
- user/workspace authorization
- calendar export and sync state

The client should own:

- current view state
- filters
- optimistic UI state
- drag/resize interaction previews

## Auth Plan

- Use Better Auth as the initial auth system.
- Use passkey-first login with required user verification.
- Require at least one recovery path before enforcing passkey-only production login.
- Do not let the browser call the database directly.

## PWA Plan

Installability and an offline shell cache are in place:

- `manifest.webmanifest`
- SVG application icon
- SvelteKit service worker
- cached shell and static assets

Defer complex offline writes until the server data model and conflict policy are stable.

## Rust Revisit Point

Do not add Rust to the first SvelteKit backend. Reconsider it only when one of these becomes materially complex:

- calendar two-way sync workers
- recurring task expansion
- bulk import/export validation
- conflict resolution jobs
- notification scheduling

If added later, Rust should run as a worker/service that shares Postgres, not as a second competing source of API truth.
