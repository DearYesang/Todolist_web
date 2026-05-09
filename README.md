# Todolist Web

SvelteKit 기반의 Kanban/Gantt/Eisenhower todo 앱입니다. 브라우저 `localStorage`를 안전한 fallback cache로 유지하면서, 로그인된 사용자는 SvelteKit API를 통해 Neon Postgres에 작업과 체크리스트를 동기화합니다.

## Current Features

- Kanban board: `todo`, `doing`, `done` 컬럼과 드래그 이동
- Gantt timeline: 작업 일정 시각화, 날짜 바 리사이즈, 작업 목록 체크리스트 미리보기와 완료 토글
- Eisenhower matrix: 중요도/시급도 기준 4분면 보기, 완료 작업 기본 숨김과 필요 시 표시
- View preference: 마지막으로 선택한 Kanban/Gantt/Eisenhower 뷰를 계정별로 저장하고, 오프라인에서는 기기별 캐시를 사용
- Task hierarchy: 상위/하위 작업, 접기/펼치기, cascade delete
- Checklist: 작업별 체크리스트, 진행률, URL 링크 표시
- Date range picker: 작업 추가와 상세 수정에서 월간 캘린더로 시작일/마감일 선택
- Filters: 중요도, 시급성, 카테고리 필터
- Backup: `kanban_backup_YYYY-MM-DD.json` 내보내기/불러오기
- Calendar integration: 전체 일정 동기화용 `.ics` 링크, 작업별 all-day `.ics` 다운로드, 로그인 세션용 `/api/calendar.ics` 제공
- Responsive PWA UI: iPhone-sized screens use compact header actions and touch-oriented add/detail sheets; iPad-sized screens keep a small-desktop layout
- Passkey onboarding: 허용 이메일 기반 패스키 생성, 복구 코드, 패스키 로그인, 로그아웃 UI
- Server sync: 인증된 작업 생성/조회/수정/삭제와 체크리스트 생성/수정/삭제, 부분 응답 merge 시 parent link 보존
- Offline queue: 실패한 서버 write와 오프라인 JSON import를 사용자별 localStorage queue에 저장하고 다음 동기화 때 재시도, task 수정/삭제 충돌은 내 변경 적용 또는 서버 유지 선택 가능
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
npm run test:e2e
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

Security posture for the public repository:

- Keep real secrets only in local `.env` files or Vercel environment variables.
- GitHub secret scanning and push protection are enabled for `DearYesang/Todolist_web`.
- CI runs `npm audit --audit-level=low`; Dependabot monitors npm/GitHub Actions updates and security updates are enabled.
- Local analysis scratch files such as `problems_*.txt` are ignored.

Production passkey registration is limited by `AUTH_ALLOWED_EMAILS`. Keep real personal emails in Vercel environment variables only; the public example uses `primary@example.com,backup@example.com`.

Production email verification can use Resend with `RESEND_API_KEY` and `EMAIL_FROM`. For the free `todokanban-alpha.vercel.app` deployment, `Todokanban <onboarding@resend.dev>` works only for the email address associated with the Resend account. `EMAIL_DELIVERY_WEBHOOK_URL` remains available as a webhook fallback.

Google/Microsoft OAuth calendar provider sync is scaffolded but hidden from the primary UI while the personal workflow stays `.ics`-first. Re-enabling provider sync later requires `CALENDAR_OAUTH_ENCRYPTION_KEY` plus the relevant OAuth client credentials. Optional Vercel Cron background sync uses `CRON_SECRET` and `CALENDAR_BACKGROUND_SYNC_MAX_USERS`.

If provider sync is re-enabled later, create a Google Auth Platform app and add the production redirect URI:

```text
https://todokanban-alpha.vercel.app/api/calendar/providers/google/callback
```

If the Google app is still in Testing, add the Google account used for sync, such as `your-google-account@gmail.com`, under **Audience -> Test users** before connecting. Testing authorizations expire after 7 days, so long-running personal provider sync is better with the app moved to **In production** after the smoke test.

## Data Model

The current local backup format is an array of tasks. Import also accepts wrapper objects shaped like `{ "tasks": [...] }`, `{ "kanbanTasks": [...] }`, or `{ "data": { "tasks": [...] } }` so older/manual backups remain portable:

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

- Email verification delivery uses Resend or `EMAIL_DELIVERY_WEBHOOK_URL` in production; preview codes are local-development only and are blocked by production config checks.
- JSON import/export supports authenticated append and replace import/export. Replace import runs through Neon HTTP `batch()` so existing-task retirement and new inserts are all-or-nothing.
- Google/Microsoft calendar provider sync routes remain available for later, but the visible calendar workflow is currently `.ics`-first: whole-board sync links and per-task `.ics` downloads. Provider webhooks and recurring events are still future work.
- Offline writes and offline JSON imports are queued per user and retried. `409` conflicts are detected, dropped from retry, surfaced with reviewable conflict details, and can be exported as JSON. Task update/delete conflicts can be replayed locally or dismissed in favor of the server; checklist/import conflict merge remains intentionally conservative.
- Vercel functions are pinned to Tokyo (`hnd1`) to keep the app close to an Asia Neon region.

## Roadmap

Near-term:

1. Run real-device smoke tests for nested tasks, checklist sync, matrix view, and offline reload on Mac/iPhone/iPad/Windows.
2. Keep the `.ics` calendar flow polished on Mac/iPhone/iPad/Windows.
3. Revisit Google Calendar OAuth only if `.ics` links are not enough for daily use.
4. Expand conflict actions to checklist and import mutations if real use shows those conflicts often.
5. Add provider webhooks and recurring calendar events if provider sync is re-enabled.

Later:

- iPhone/iPad wrapper with Capacitor if native capabilities become necessary
- Windows PWA first, Tauri only if desktop-native behavior is required
- Rust worker only if calendar sync, recurring task expansion, or bulk import/export become heavy enough to justify a separate service

See [SvelteKit migration notes](docs/SVELTEKIT_MIGRATION.md) and [database schema draft](docs/DATABASE_SCHEMA.md) for the proposed architecture.
See [implementation status](docs/IMPLEMENTATION_STATUS.md) for the current plan-vs-state comparison.
See [Vercel + Neon deployment plan](docs/VERCEL_NEON_DEPLOYMENT.md) for the personal production setup.
See [deployment checklist](docs/DEPLOYMENT_CHECKLIST.md) before promoting this branch.

## License

Copyright 2026 DearYesang

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

## Security Notes

- Secrets must live in `.env` files and stay out of git.
- Commit `.env.example`, not real credentials.
- Calendar OAuth tokens are encrypted at rest with `CALENDAR_OAUTH_ENCRYPTION_KEY` if provider sync is re-enabled.
- Whole-board `.ics` feed URLs use revocable tokens.
- Set `CALENDAR_TOKEN_SECRET`, `ACCOUNT_RECOVERY_SECRET`, and `CALENDAR_OAUTH_ENCRYPTION_KEY` separately from auth secrets before production use.
- All future write APIs must validate task ownership, date ranges, and parent graph integrity server-side.
