import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '$lib/server/db/index.js';
import { normalizeCategoryName } from '$lib/shared/category-suggestions.js';
import { TaskWriteError } from '$lib/server/tasks/validation.js';

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/**
 * @param {string} name
 */
export function normalizeCategoryKey(name) {
	return normalizeCategoryName(name).toLocaleLowerCase('ko');
}

/**
 * @param {typeof schema.categories.$inferSelect} row
 */
export function mapCategoryRowToClientCategory(row) {
	return {
		id: row.id,
		name: row.name,
		color: row.color,
		sortOrder: row.sortOrder,
		hiddenAt: row.hiddenAt ? row.hiddenAt.toISOString() : null,
		archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null
	};
}

/**
 * @param {ReturnType<typeof import('$lib/server/db/index.js').getDb>} db
 * @param {string} boardId
 * @param {{ includeArchived?: boolean }} [options]
 */
export async function listCategoryRowsForBoard(db, boardId, options = {}) {
	return db
		.select()
		.from(schema.categories)
		.where(and(
			eq(schema.categories.boardId, boardId),
			...(options.includeArchived ? [] : [isNull(schema.categories.archivedAt)])
		))
		.orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));
}

/**
 * @param {ReturnType<typeof import('$lib/server/db/index.js').getDb>} db
 * @param {string} boardId
 * @param {string} categoryId
 * @param {{ includeArchived?: boolean }} [options]
 */
export async function getCategoryRowForBoard(db, boardId, categoryId, options = {}) {
	const [category] = await db
		.select()
		.from(schema.categories)
		.where(and(
			eq(schema.categories.id, categoryId),
			eq(schema.categories.boardId, boardId),
			...(options.includeArchived ? [] : [isNull(schema.categories.archivedAt)])
		))
		.limit(1);

	return category ?? null;
}

/**
 * @param {ReturnType<typeof import('$lib/server/db/index.js').getDb>} db
 * @param {string} boardId
 * @param {string} normalizedName
 * @param {{ includeArchived?: boolean }} [options]
 */
export async function getCategoryRowByNormalizedName(db, boardId, normalizedName, options = {}) {
	const [category] = await db
		.select()
		.from(schema.categories)
		.where(and(
			eq(schema.categories.boardId, boardId),
			eq(schema.categories.normalizedName, normalizedName),
			...(options.includeArchived ? [] : [isNull(schema.categories.archivedAt)])
		))
		.limit(1);

	return category ?? null;
}

/**
 * @param {ReturnType<typeof import('$lib/server/db/index.js').getDb>} db
 * @param {{ boardId: string; userId: string; name: string }} input
 */
export async function findOrCreateCategoryRow(db, input) {
	const name = parseCategoryName(input.name);
	if (!name) {
		return null;
	}

	const normalizedName = normalizeCategoryKey(name);
	const existing = await getCategoryRowByNormalizedName(db, input.boardId, normalizedName, { includeArchived: true });
	if (existing) {
		if (!existing.archivedAt) {
			return existing;
		}

		const [reactivated] = await db
			.update(schema.categories)
			.set({
				name,
				color: existing.color,
				hiddenAt: null,
				archivedAt: null,
				updatedAt: new Date()
			})
			.where(eq(schema.categories.id, existing.id))
			.returning();
		return reactivated ?? existing;
	}

	const now = new Date();
	const sortOrder = await getNextSortOrder(db, input.boardId);
	const [created] = await db
		.insert(schema.categories)
		.values({
			boardId: input.boardId,
			userId: input.userId,
			name,
			normalizedName,
			color: null,
			sortOrder,
			hiddenAt: null,
			archivedAt: null,
			createdAt: now,
			updatedAt: now
		})
		.onConflictDoNothing({
			target: [schema.categories.boardId, schema.categories.normalizedName]
		})
		.returning();

	return created ?? await getCategoryRowByNormalizedName(db, input.boardId, normalizedName, { includeArchived: true });
}

/**
 * @param {unknown} value
 */
export function parseCategoryName(value) {
	if (value === undefined || value === null) {
		return '';
	}
	if (typeof value !== 'string') {
		throw new TaskWriteError('Category name must be a string.');
	}

	const name = normalizeCategoryName(value);
	if (name.length > 80) {
		throw new TaskWriteError('Category name must be 80 characters or less.');
	}
	return name;
}

/**
 * @param {unknown} value
 */
export function parseCategoryColor(value) {
	if (value === undefined) {
		return undefined;
	}
	if (value === null || value === '') {
		return null;
	}
	if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
		throw new TaskWriteError('Category color must be a #RRGGBB hex color.');
	}
	return value.toLowerCase();
}

/**
 * @param {ReturnType<typeof import('$lib/server/db/index.js').getDb>} db
 * @param {string} boardId
 */
async function getNextSortOrder(db, boardId) {
	const [result] = await db
		.select({ nextSortOrder: sql`coalesce(max(${schema.categories.sortOrder}), -1) + 1` })
		.from(schema.categories)
		.where(eq(schema.categories.boardId, boardId));

	const value = Number(result?.nextSortOrder ?? 0);
	return Number.isFinite(value) ? value : 0;
}
