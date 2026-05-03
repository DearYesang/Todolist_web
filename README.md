# Todolist Web

SvelteKit 기반의 Kanban/Gantt todo 앱입니다. 브라우저 `localStorage`를 안전한 fallback cache로 유지하면서, 로그인된 사용자는 SvelteKit API를 통해 Neon Postgres에 작업과 체크리스트를 동기화합니다.

## Current Features

- Kanban board: `todo`, `doing`, `done` 컬럼과 드래그 이동
- Gantt timeline: 작업 일정 시각화와 날짜 바 리사이즈
- Task hierarchy: 상위/하위 작업, 접기/펼치기, cascade delete
- Checklist: 작업별 체크리스트, 진행률, URL 링크 표시
- Filters: 중요도, 시급성, 카테고리 필터
- Backup: `kanban_backup_YYYY-MM-DD.json` 내보내기/불러오기
- Calendar export: 현재 작업을 all-day `.ics` 파일로 내보내기, 로그인 세션용 `/api/calendar.ics` 제공
- Passkey onboarding: 패스키 생성, 패스키 로그인, 로그아웃 UI
- Server sync: 인증된 작업 생성/조회/수정/삭제와 체크리스트 생성/수정/삭제

## Tech Stack

- Svelte 5
- SvelteKit
- Vite build pipeline
- Vitest
- Neon Postgres + Drizzle
- Better Auth + passkey
- PWA manifest and offline shell cache
- Browser `localStorage` fallback cache

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

The database and auth clients are initialized so local tests and builds do not require a `DATABASE_URL`. Auth and server sync routes return `503` until database credentials are configured.

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

The domain rules are isolated in `src/lib/shared/task-domain.js`; browser persistence, optimistic mutations, and fallback behavior live in `src/lib/client/task-store.js`.

## Current Limits

- Passkey registration is enabled for onboarding, but production should add an email verification or recovery path before enforcing passkey-only access.
- JSON import/export still works against the client cache; server-side import with legacy ID mapping is not implemented yet.
- Revocable-token calendar subscription and two-way sync are planned but not implemented
- Offline writes remain local-first and best-effort; a formal conflict queue is not implemented yet.

## Roadmap

Near-term:

1. Stabilize local domain rules and tests.
2. Add server-side JSON import/export with legacy ID mapping.
3. Add revocable-token iCalendar subscription feed.
4. Add conflict policy for offline server-backed writes.
5. Add account recovery or verified email before production passkey-only enforcement.

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
