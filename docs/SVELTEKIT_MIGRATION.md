# SvelteKit Migration Notes

The project has moved from a Svelte 5 + Vite SPA shell to a SvelteKit shell. The app keeps browser `localStorage` as a fallback cache, while authenticated users can sync tasks and checklist items through SvelteKit API routes backed by Neon Postgres.

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

Local iCalendar export uses `src/lib/shared/calendar-ics.js`; `/api/calendar.ics` uses the same generator for authenticated server-backed calendar downloads.

Authenticated task routes now cover read/create/update/delete plus checklist create/update/delete:

- `src/routes/api/tasks/+server.js`
- `src/routes/api/tasks/[taskId]/+server.js`
- `src/routes/api/tasks/[taskId]/checklist/+server.js`
- `src/routes/api/tasks/[taskId]/checklist/[itemId]/+server.js`

Client mutations are optimistic. Server UUID-backed records sync to the API; local-only IDs remain in the fallback cache until a server import/conflict policy exists.

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

1. Keep JSON import/export compatible by mapping legacy `id` and `parentId` values during server import.
2. Add revocable-token iCalendar subscription feed after token strategy is defined.
3. Define conflict policy for offline server-backed writes.
4. Add route/component tests around auth and sync flows once UI flows stabilize.

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
- Use passkey-first login with platform authenticators.
- Passkey-first onboarding is enabled by resolving a registration email/name into a Better Auth user.
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
