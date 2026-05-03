# Todolist Web

SvelteKit 기반의 로컬 우선 Kanban/Gantt todo 앱입니다. 현재 버전은 브라우저 `localStorage`에 작업을 저장하고, JSON 백업/복원으로 데이터를 옮길 수 있습니다.

## Current Features

- Kanban board: `todo`, `doing`, `done` 컬럼과 드래그 이동
- Gantt timeline: 작업 일정 시각화와 날짜 바 리사이즈
- Task hierarchy: 상위/하위 작업, 접기/펼치기, cascade delete
- Checklist: 작업별 체크리스트, 진행률, URL 링크 표시
- Filters: 중요도, 시급성, 카테고리 필터
- Backup: `kanban_backup_YYYY-MM-DD.json` 내보내기/불러오기

## Tech Stack

- Svelte 5
- SvelteKit
- Vite build pipeline
- Vitest
- Neon Postgres + Drizzle scaffold
- Better Auth + passkey scaffold
- PWA manifest and offline shell cache
- Browser `localStorage`

Legacy vanilla HTML/CSS/JS implementation is preserved on the `legacy` branch. The `main` branch tracks the Svelte app only.

## Getting Started

```bash
npm ci
npm run dev
```

Build and preview:

```bash
npm run build
npm run preview
```

Run tests:

```bash
npm test
```

Database setup:

```bash
cp .env.example .env
npm run db:generate
npm run db:migrate
```

The database and auth clients are initialized so local tests and builds do not require a `DATABASE_URL`. Auth routes return `503` until database credentials are configured.

## Data Model

The current local backup format is an array of tasks:

```js
{
  id: string,
  text: string,
  status: 'todo' | 'doing' | 'done',
  startDate: 'YYYY-MM-DD',
  endDate: 'YYYY-MM-DD',
  priority: 'high' | 'medium' | 'low',
  urgency: 'urgent' | 'normal',
  category: string,
  parentId: string | null,
  subtasks: [{ id: string, text: string, done: boolean }],
  collapsed: boolean,
  createdAt: number
}
```

Imported data is normalized before it reaches the app store:

- duplicate task and checklist IDs are repaired
- invalid enum values fall back to safe defaults
- invalid or inverted dates are corrected
- very long task ranges are capped
- missing, self-referential, or cyclic parent links are removed
- child status is aligned with the effective parent lane

The domain rules are isolated in `src/lib/shared/task-domain.js`; browser persistence and writable stores live in `src/lib/client/task-store.js`.

## Current Limits

- Auth backend routes exist, but account onboarding UI is not implemented yet
- Server database schema exists, but the app still reads/writes local browser storage
- No cross-device sync yet
- Calendar integration is planned but not implemented
- Offline writes are still local-only; the installed app shell is cached for repeat visits

## Roadmap

Near-term:

1. Stabilize local domain rules and tests.
2. Add account onboarding UI around passkeys.
3. Implement server task services and SvelteKit API routes/actions.
4. Switch the client store to server-backed optimistic mutations.
5. Add read-only iCalendar feed.
6. Add conflict policy for offline server-backed writes.

Later:

- Google/Microsoft calendar two-way sync
- iPhone/iPad wrapper with Capacitor if native capabilities become necessary
- Windows PWA first, Tauri only if desktop-native behavior is required
- Rust worker only if calendar sync, recurring task expansion, or bulk import/export become heavy enough to justify a separate service

See [SvelteKit migration notes](docs/SVELTEKIT_MIGRATION.md) and [database schema draft](docs/DATABASE_SCHEMA.md) for the proposed architecture.

## Security Notes

- Secrets must live in `.env` files and stay out of git.
- Commit `.env.example`, not real credentials.
- Calendar OAuth tokens should be encrypted at rest once sync is added.
- iCalendar feed URLs should use revocable tokens.
- All future write APIs must validate task ownership, date ranges, and parent graph integrity server-side.
