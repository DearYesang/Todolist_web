# Todolist Web

SvelteKit 기반의 Kanban/Gantt todo 앱입니다. 브라우저 `localStorage`를 안전한 fallback cache로 유지하면서, 로그인된 사용자는 SvelteKit API를 통해 Neon Postgres에 작업과 체크리스트를 동기화합니다.

## Current Features

- Kanban board: `todo`, `doing`, `done` 컬럼과 드래그 이동
- Gantt timeline: 작업 일정 시각화와 날짜 바 리사이즈
- Task hierarchy: 상위/하위 작업, 접기/펼치기, cascade delete
- Checklist: 작업별 체크리스트, 진행률, URL 링크 표시
- Filters: 중요도, 시급성, 카테고리 필터
- Backup: `kanban_backup_YYYY-MM-DD.json` 내보내기/불러오기
- Calendar export: 현재 작업을 all-day `.ics` 파일로 내보내기, 로그인 세션용 `/api/calendar.ics`와 revocable token 구독 feed 제공
- Calendar sync: Google/Microsoft OAuth 연결, 암호화된 토큰 저장, 수동 provider sync와 최근 sync 로그
- Passkey onboarding: 허용 이메일 기반 패스키 생성, 복구 코드, 패스키 로그인, 로그아웃 UI
- Server sync: 인증된 작업 생성/조회/수정/삭제와 체크리스트 생성/수정/삭제
- Offline queue: 실패한 서버 write를 사용자별 localStorage queue에 저장하고 다음 동기화 때 재시도
- Private mode: 로그인 전 앱 본문 숨김, 이전 로그인 기기는 오프라인 상태에서도 사용자별 로컬 캐시로 작업 가능

## Tech Stack

- Svelte 5
- SvelteKit
- Vite build pipeline
- Vercel serverless deployment target
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

Run the production readiness check:

```bash
npm run secrets
npm run doctor
```

`npm run secrets` prints Vercel-ready secret values. Keep the output out of git.

Database setup:

```bash
cp .env.example .env
npm run db:generate
npm run db:migrate
```

The database and auth clients are initialized so local tests and builds do not require a `DATABASE_URL`. Auth and server sync routes return `503` until database credentials are configured.

Calendar subscription tokens also require `CALENDAR_TOKEN_SECRET`. Raw subscription tokens are returned only once and stored as HMAC hashes in Postgres.

Production passkey registration is limited by `AUTH_ALLOWED_EMAILS`. For this deployment, set it to `scyea@naver.com,scyea1995@gmail.com`.

Production email verification can use Resend with `RESEND_API_KEY` and `EMAIL_FROM`. For the free `todokanban.vercel.app` deployment, `Todokanban <onboarding@resend.dev>` works only for the email address associated with the Resend account. `EMAIL_DELIVERY_WEBHOOK_URL` remains available as a webhook fallback.

Calendar provider sync additionally requires `CALENDAR_OAUTH_ENCRYPTION_KEY` plus the relevant Google/Microsoft OAuth client credentials. Google Calendar is the first provider to configure for the personal deployment.

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

- Email verification delivery uses Resend or `EMAIL_DELIVERY_WEBHOOK_URL` in production; local dev can show preview codes with `EMAIL_VERIFICATION_DEV_CODES=true`.
- JSON import/export supports authenticated append and replace import/export. Replace import runs through Neon HTTP `batch()` so delete/insert work is all-or-nothing.
- Google/Microsoft calendar sync is manual and capped per run for now; background workers, webhooks, and recurring events are still future work.
- Offline writes are queued per user and retried; `409` conflicts are detected and dropped from retry, but full multi-device conflict resolution is still intentionally simple.
- Vercel functions are pinned to Tokyo (`hnd1`) to keep the app close to an Asia Neon region.

## Roadmap

Near-term:

1. Deploy to Vercel with `todokanban.vercel.app`, Neon Asia, Resend sandbox delivery, and manual DB migrations.
2. Add broader route-level integration tests around auth, import replace, offline replay, and calendar sync.
3. Add richer multi-device conflict resolution for queued offline writes.
4. Add background calendar sync workers and provider webhooks.

Later:

- iPhone/iPad wrapper with Capacitor if native capabilities become necessary
- Windows PWA first, Tauri only if desktop-native behavior is required
- Rust worker only if calendar sync, recurring task expansion, or bulk import/export become heavy enough to justify a separate service

See [SvelteKit migration notes](docs/SVELTEKIT_MIGRATION.md) and [database schema draft](docs/DATABASE_SCHEMA.md) for the proposed architecture.
See [Vercel + Neon deployment plan](docs/VERCEL_NEON_DEPLOYMENT.md) for the personal production setup.
See [deployment checklist](docs/DEPLOYMENT_CHECKLIST.md) before promoting this branch.

## Security Notes

- Secrets must live in `.env` files and stay out of git.
- Commit `.env.example`, not real credentials.
- Calendar OAuth tokens are encrypted at rest with `CALENDAR_OAUTH_ENCRYPTION_KEY`.
- iCalendar feed URLs should use revocable tokens.
- Set `CALENDAR_TOKEN_SECRET`, `ACCOUNT_RECOVERY_SECRET`, and `CALENDAR_OAUTH_ENCRYPTION_KEY` separately from auth secrets before production use.
- All future write APIs must validate task ownership, date ranges, and parent graph integrity server-side.
