import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

const timestamps = () => ({
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const user = pgTable(
	'user',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		email: text('email').notNull(),
		emailVerified: boolean('email_verified').notNull().default(false),
		image: text('image'),
		...timestamps()
	},
	(table) => [uniqueIndex('user_email_uidx').on(table.email)]
);

export const session = pgTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		token: text('token').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(table) => [
		uniqueIndex('session_token_uidx').on(table.token),
		index('session_user_id_idx').on(table.userId)
	]
);

export const account = pgTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
		scope: text('scope'),
		password: text('password'),
		...timestamps()
	},
	(table) => [
		index('account_user_id_idx').on(table.userId),
		uniqueIndex('account_provider_account_uidx').on(table.providerId, table.accountId)
	]
);

export const verification = pgTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		...timestamps()
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)]
);

export const passkey = pgTable(
	'passkey',
	{
		id: text('id').primaryKey(),
		name: text('name'),
		publicKey: text('public_key').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		credentialID: text('credential_id').notNull(),
		counter: integer('counter').notNull(),
		deviceType: text('device_type').notNull(),
		backedUp: boolean('backed_up').notNull(),
		transports: text('transports'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		aaguid: text('aaguid')
	},
	(table) => [
		index('passkey_user_id_idx').on(table.userId),
		uniqueIndex('passkey_credential_id_uidx').on(table.credentialID)
	]
);

export const workspaces = pgTable(
	'workspaces',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull(),
		ownerUserId: text('owner_user_id').notNull(),
		...timestamps()
	},
	(table) => [
		index('workspaces_owner_user_id_idx').on(table.ownerUserId),
		uniqueIndex('workspaces_owner_name_uidx').on(table.ownerUserId, table.name)
	]
);

export const workspaceMembers = pgTable(
	'workspace_members',
	{
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: text('user_id').notNull(),
		role: text('role').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		primaryKey({ columns: [table.workspaceId, table.userId] }),
		index('workspace_members_user_id_idx').on(table.userId),
		check('workspace_members_role_check', sql`${table.role} in ('owner', 'admin', 'member')`)
	]
);

export const boards = pgTable(
	'boards',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		defaultView: text('default_view').notNull().default('kanban'),
		...timestamps()
	},
	(table) => [
		index('boards_workspace_id_idx').on(table.workspaceId),
		uniqueIndex('boards_workspace_name_uidx').on(table.workspaceId, table.name),
		check('boards_default_view_check', sql`${table.defaultView} in ('kanban', 'gantt')`)
	]
);

export const tasks = pgTable(
	'tasks',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		boardId: uuid('board_id')
			.notNull()
			.references(() => boards.id, { onDelete: 'cascade' }),
		parentTaskId: uuid('parent_task_id'),
		title: text('title').notNull(),
		status: text('status').notNull(),
		priority: text('priority').notNull(),
		urgency: text('urgency').notNull(),
		category: text('category').notNull().default(''),
		startDate: date('start_date').notNull(),
		endDate: date('end_date').notNull(),
		position: numeric('position', { precision: 20, scale: 10 }).notNull().default('0'),
		createdBy: text('created_by').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(table) => [
		index('tasks_board_status_position_idx').on(table.boardId, table.status, table.position),
		index('tasks_board_date_range_idx').on(table.boardId, table.startDate, table.endDate),
		index('tasks_parent_task_id_idx').on(table.parentTaskId),
		index('tasks_board_category_idx').on(table.boardId, table.category),
		index('tasks_board_deleted_at_idx').on(table.boardId, table.deletedAt),
		foreignKey({
			columns: [table.parentTaskId],
			foreignColumns: [table.id],
			name: 'tasks_parent_task_id_tasks_id_fk'
		}).onDelete('set null'),
		check('tasks_status_check', sql`${table.status} in ('todo', 'doing', 'done')`),
		check('tasks_priority_check', sql`${table.priority} in ('high', 'medium', 'low')`),
		check('tasks_urgency_check', sql`${table.urgency} in ('urgent', 'normal')`),
		check('tasks_date_range_check', sql`${table.endDate} >= ${table.startDate}`),
		check('tasks_no_self_parent_check', sql`${table.parentTaskId} is null or ${table.parentTaskId} <> ${table.id}`)
	]
);

export const checklistItems = pgTable(
	'checklist_items',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => tasks.id, { onDelete: 'cascade' }),
		text: text('text').notNull(),
		done: boolean('done').notNull().default(false),
		position: numeric('position', { precision: 20, scale: 10 }).notNull().default('0'),
		...timestamps()
	},
	(table) => [index('checklist_items_task_position_idx').on(table.taskId, table.position)]
);

export const calendarConnections = pgTable(
	'calendar_connections',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: text('user_id').notNull(),
		provider: text('provider').notNull(),
		providerAccountId: text('provider_account_id'),
		encryptedAccessToken: text('encrypted_access_token'),
		encryptedRefreshToken: text('encrypted_refresh_token'),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		...timestamps()
	},
	(table) => [
		index('calendar_connections_workspace_provider_idx').on(table.workspaceId, table.provider),
		check('calendar_connections_provider_check', sql`${table.provider} in ('google', 'microsoft', 'caldav')`)
	]
);

export const calendarEventLinks = pgTable(
	'calendar_event_links',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		taskId: uuid('task_id')
			.notNull()
			.references(() => tasks.id, { onDelete: 'cascade' }),
		connectionId: uuid('connection_id')
			.notNull()
			.references(() => calendarConnections.id, { onDelete: 'cascade' }),
		externalCalendarId: text('external_calendar_id').notNull(),
		externalEventId: text('external_event_id').notNull(),
		etag: text('etag'),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		syncStatus: text('sync_status').notNull().default('active')
	},
	(table) => [
		index('calendar_event_links_task_id_idx').on(table.taskId),
		uniqueIndex('calendar_event_links_external_event_uidx').on(
			table.connectionId,
			table.externalCalendarId,
			table.externalEventId
		),
		check('calendar_event_links_sync_status_check', sql`${table.syncStatus} in ('active', 'deleted', 'error')`)
	]
);

export const syncCursors = pgTable(
	'sync_cursors',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		connectionId: uuid('connection_id')
			.notNull()
			.references(() => calendarConnections.id, { onDelete: 'cascade' }),
		resource: text('resource').notNull(),
		cursor: text('cursor').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('sync_cursors_connection_resource_uidx').on(table.connectionId, table.resource)
	]
);
