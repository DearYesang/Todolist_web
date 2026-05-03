# Database Schema Draft

Target stack: Neon Postgres + Drizzle + Better Auth. The app and auth schemas are scaffolded in `src/lib/server/db/schema.js`; generated migrations should be committed from `drizzle/`.

## Principles

- Drizzle migrations should be the source of truth.
- Browser clients should never write directly to Postgres.
- Every write must validate user membership, date integrity, and parent graph integrity.
- Keep the current JSON backup shape importable during the migration.
- Calendar sync tables may exist ahead of the feature, but routes should not expose write sync until token encryption and provider flows are implemented.

## Auth Tables

Better Auth owns the auth tables. The current Drizzle schema includes:

- `user`
- `session`
- `account`
- `verification`
- `passkey`

When Better Auth or passkey plugin versions change, compare the schema against `npx auth@latest generate` before creating a new Drizzle migration. App tables keep user IDs as text; cross-table foreign keys can be tightened after task ownership services are implemented.

Calendar subscription tokens are app-owned, but they reference Better Auth users and never store raw token values.

## App Tables

### workspaces

```txt
id uuid primary key
name text not null
owner_user_id text not null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
unique (owner_user_id, name)
```

Even for a personal app, `workspaces` keeps the future collaboration boundary clean.

### workspace_members

```txt
workspace_id uuid not null references workspaces(id) on delete cascade
user_id text not null
role text not null check (role in ('owner', 'admin', 'member'))
created_at timestamptz not null default now()
primary key (workspace_id, user_id)
```

### boards

```txt
id uuid primary key
workspace_id uuid not null references workspaces(id) on delete cascade
name text not null
default_view text not null default 'kanban' check (default_view in ('kanban', 'gantt'))
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
unique (workspace_id, name)
```

### tasks

```txt
id uuid primary key
board_id uuid not null references boards(id) on delete cascade
parent_task_id uuid references tasks(id) on delete set null
title text not null
status text not null check (status in ('todo', 'doing', 'done'))
priority text not null check (priority in ('high', 'medium', 'low'))
urgency text not null check (urgency in ('urgent', 'normal'))
category text not null default ''
start_date date not null
end_date date not null
position numeric(20, 10) not null default 0
created_by text not null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
completed_at timestamptz
deleted_at timestamptz
check (end_date >= start_date)
check (parent_task_id is null or parent_task_id <> id)
```

Cycle prevention should start in the service layer. Add a Postgres trigger later if collaborative editing makes defense in depth necessary.

### checklist_items

```txt
id uuid primary key
task_id uuid not null references tasks(id) on delete cascade
text text not null
done boolean not null default false
position numeric(20, 10) not null default 0
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## Calendar Tables

Provider sync tables are scaffolded ahead of the feature. Subscription tokens are active.

### calendar_subscription_tokens

```txt
id uuid primary key
user_id text not null references user(id) on delete cascade
workspace_id uuid not null references workspaces(id) on delete cascade
board_id uuid not null references boards(id) on delete cascade
name text not null default 'Calendar feed'
token_hash text not null unique
token_prefix text not null
created_at timestamptz not null default now()
last_used_at timestamptz
revoked_at timestamptz
expires_at timestamptz
```

The raw token is generated with CSPRNG bytes and returned once. Store only `HMAC-SHA256(CALENDAR_TOKEN_SECRET, rawToken)`.

### calendar_connections

```txt
id uuid primary key
workspace_id uuid not null references workspaces(id) on delete cascade
user_id text not null
provider text not null check (provider in ('google', 'microsoft', 'caldav'))
provider_account_id text
encrypted_access_token text
encrypted_refresh_token text
expires_at timestamptz
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

### calendar_event_links

```txt
id uuid primary key
task_id uuid not null references tasks(id) on delete cascade
connection_id uuid not null references calendar_connections(id) on delete cascade
external_calendar_id text not null
external_event_id text not null
etag text
last_synced_at timestamptz
sync_status text not null default 'active'
unique (connection_id, external_calendar_id, external_event_id)
```

### sync_cursors

```txt
id uuid primary key
connection_id uuid not null references calendar_connections(id) on delete cascade
resource text not null
cursor text not null
updated_at timestamptz not null default now()
unique (connection_id, resource)
```

## Recommended Indexes

```txt
workspace_members(user_id)
workspaces(owner_user_id, name) unique
boards(workspace_id)
boards(workspace_id, name) unique
tasks(board_id, status, position)
tasks(board_id, start_date, end_date)
tasks(parent_task_id)
tasks(board_id, category)
tasks(board_id, deleted_at)
checklist_items(task_id, position)
calendar_connections(workspace_id, provider)
calendar_connections(user_id, provider, provider_account_id) unique
calendar_subscription_tokens(user_id)
calendar_subscription_tokens(board_id)
calendar_subscription_tokens(token_hash) unique
calendar_event_links(task_id)
sync_cursors(connection_id, resource)
```

## Import Strategy

1. Create a default workspace and board for the user if none exists.
2. Parse the legacy JSON backup.
3. Normalize each task using the same domain rules as the current local store.
4. Generate new UUIDs for tasks and checklist items.
5. Keep an old-id to new-id map.
6. Reconnect valid parent links through the map.
7. Insert tasks first, then checklist items through a Neon HTTP `batch()` transaction.
8. Return an import summary with skipped or repaired counts.

## Export Strategy

For now, keep exporting the current JSON shape. That keeps user backups portable while the backend evolves.

## Implemented Server Services

- Personal `Personal` workspace and `Inbox` board provisioning for first authenticated task creation.
- Authenticated task list/create/update/soft-delete cascade.
- Authenticated checklist create/update/delete.
- Authenticated read-only `/api/calendar.ics` download backed by server tasks.
- Revocable token-based `/api/calendar/subscriptions/[token].ics` feed backed by token hashes.
- OAuth-backed Google/Microsoft calendar connections with encrypted provider tokens.
- Manual calendar provider sync that upserts/deletes linked all-day events.
- Email-code passkey onboarding and hashed recovery codes.
- Offline client write queue for retryable server mutations.
- Parent ownership and cycle validation in the service layer.

Server append/replace import and provider sync foundations are implemented. Background calendar workers, provider webhooks, and richer conflict resolution are still planned.
