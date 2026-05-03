# Database Schema Draft

Target stack: Neon Postgres + Drizzle + Better Auth. This is a planning draft, not an implemented migration.

## Principles

- Drizzle migrations should be the source of truth.
- Browser clients should never write directly to Postgres.
- Every write must validate user membership, date integrity, and parent graph integrity.
- Keep the current JSON backup shape importable during the migration.
- Add calendar sync tables only when sync is implemented.

## Auth Tables

Better Auth should own its generated auth tables. Expected categories:

- `user`
- `session`
- `account`
- `verification`
- passkey/WebAuthn credential tables, depending on the Better Auth plugin output

Do not hand-edit generated auth tables unless the adapter requires explicit schema ownership.

## App Tables

### workspaces

```txt
id uuid primary key
name text not null
owner_user_id text not null references user(id)
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Even for a personal app, `workspaces` keeps the future collaboration boundary clean.

### workspace_members

```txt
workspace_id uuid not null references workspaces(id) on delete cascade
user_id text not null references user(id) on delete cascade
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
created_by text not null references user(id)
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

Add these after read-only calendar export is stable.

### calendar_connections

```txt
id uuid primary key
workspace_id uuid not null references workspaces(id) on delete cascade
user_id text not null references user(id) on delete cascade
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
boards(workspace_id)
tasks(board_id, status, position)
tasks(board_id, start_date, end_date)
tasks(parent_task_id)
tasks(board_id, category)
tasks(board_id, deleted_at)
checklist_items(task_id, position)
calendar_connections(workspace_id, provider)
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
7. Insert tasks first, then checklist items.
8. Return an import summary with skipped or repaired counts.

## Export Strategy

For now, keep exporting the current JSON shape. That keeps user backups portable while the backend evolves.
