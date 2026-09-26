import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db/index.js';
import { ensurePersonalBoardForUser } from '$lib/server/boards/board-provisioning.js';
import { ApiError } from '$lib/server/http/api-error.js';
import {
	findOrCreateCategoryRow,
	getCategoryRowForBoard,
	listCategoryRowsForBoard,
	mapCategoryRowToClientCategory,
	parseCategoryColor,
	parseCategoryName
} from './category-service.js';
import { normalizeCategoryKey } from '$lib/shared/category-suggestions.js';
import { UUID_PATTERN } from '$lib/shared/task-rules.js';

/**
 * Rename, merge and delete rewrite every task in the category and bump its
 * version. They return the new versions so the client can advance its copies:
 * a copy left on the old version sends a stale expectedVersion with its next
 * edit and gets a false 409.
 */
const TASK_VERSION_COLUMNS = { id: schema.tasks.id, version: schema.tasks.version };

/**
 * @param {string} userId
 */
export async function listCategoriesForUser(userId) {
	const db = getDb();
	const board = await ensurePersonalBoardForUser(userId);
	const categories = await listCategoryRowsForBoard(db, board.id);
	return categories.map(mapCategoryRowToClientCategory);
}

/**
 * @param {string} userId
 * @param {unknown} payload
 */
export async function createCategoryForUser(userId, payload) {
	const input = parseCategoryCreatePayload(payload);
	const db = getDb();
	const board = await ensurePersonalBoardForUser(userId);
	const category = await findOrCreateCategoryRow(db, {
		boardId: board.id,
		userId,
		name: input.name
	});
	if (!category) {
		throw new ApiError('Category name is required.');
	}

	if (input.color !== undefined || input.hidden !== undefined) {
		const [updated] = await db
			.update(schema.categories)
			.set({
				...(input.color === undefined ? {} : { color: input.color }),
				...(input.hidden === undefined ? {} : { hiddenAt: input.hidden ? new Date() : null }),
				updatedAt: new Date()
			})
			.where(and(eq(schema.categories.id, category.id), eq(schema.categories.boardId, board.id)))
			.returning();
		return mapCategoryRowToClientCategory(updated ?? category);
	}

	return mapCategoryRowToClientCategory(category);
}

/**
 * @param {string} userId
 * @param {unknown} categoryId
 * @param {unknown} payload
 */
export async function updateCategoryForUser(userId, categoryId, payload) {
	const id = parseCategoryId(categoryId);
	const input = parseCategoryPatchPayload(payload);
	const db = getDb();
	const board = await ensurePersonalBoardForUser(userId);
	const existing = await getCategoryRowForBoard(db, board.id, id);
	if (!existing) {
		throw new ApiError('Category was not found.', 404);
	}

	const now = new Date();
	const nextName = input.name ?? existing.name;
	const nextNormalizedName = input.name === undefined ? existing.normalizedName : normalizeCategoryKey(input.name);
	const nextHiddenAt = input.hidden === undefined ? existing.hiddenAt : input.hidden ? existing.hiddenAt ?? now : null;
	const nextArchivedAt = input.archived === undefined ? existing.archivedAt : input.archived ? existing.archivedAt ?? now : null;
	const nextColor = input.color === undefined ? existing.color : input.color;

	try {
		const [updatedCategory, updatedTasks = []] = await db.batch([
			db
				.update(schema.categories)
				.set({
					name: nextName,
					normalizedName: nextNormalizedName,
					color: nextColor,
					hiddenAt: nextHiddenAt,
					archivedAt: nextArchivedAt,
					updatedAt: now
				})
				.where(and(eq(schema.categories.id, existing.id), eq(schema.categories.boardId, board.id)))
				.returning(),
			...(input.name === undefined
				? []
				: [
					db
						.update(schema.tasks)
						.set({
							category: nextName,
							updatedAt: now,
							version: sql`${schema.tasks.version} + 1`
						})
						.where(and(
							eq(schema.tasks.boardId, board.id),
							eq(schema.tasks.categoryId, existing.id),
							isNull(schema.tasks.deletedAt)
						))
						.returning(TASK_VERSION_COLUMNS)
				])
		]);

		if (!updatedCategory[0]) {
			throw new ApiError('Category could not be updated.', 500);
		}

		return {
			category: mapCategoryRowToClientCategory(updatedCategory[0]),
			updatedTasks: updatedTasks.length,
			taskVersions: updatedTasks
		};
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			throw new ApiError('A category with that name already exists.', 409);
		}
		throw error;
	}
}

/**
 * @param {string} userId
 * @param {unknown} sourceCategoryId
 * @param {unknown} payload
 */
export async function mergeCategoryForUser(userId, sourceCategoryId, payload) {
	const sourceId = parseCategoryId(sourceCategoryId);
	const targetId = parseCategoryId(readPayloadObject(payload).targetCategoryId);
	if (sourceId === targetId) {
		throw new ApiError('Source and target categories must be different.');
	}

	const db = getDb();
	const board = await ensurePersonalBoardForUser(userId);
	const [source, target] = await Promise.all([
		getCategoryRowForBoard(db, board.id, sourceId),
		getCategoryRowForBoard(db, board.id, targetId)
	]);
	if (!source || !target) {
		throw new ApiError('Category was not found.', 404);
	}

	const now = new Date();
	const [updatedTasks, archivedSource] = await db.batch([
		db
			.update(schema.tasks)
			.set({
				categoryId: target.id,
				category: target.name,
				updatedAt: now,
				version: sql`${schema.tasks.version} + 1`
			})
			.where(and(
				eq(schema.tasks.boardId, board.id),
				eq(schema.tasks.categoryId, source.id),
				isNull(schema.tasks.deletedAt)
			))
			.returning(TASK_VERSION_COLUMNS),
		db
			.update(schema.categories)
			.set({
				archivedAt: now,
				hiddenAt: now,
				updatedAt: now
			})
			.where(and(eq(schema.categories.id, source.id), eq(schema.categories.boardId, board.id)))
			.returning()
	]);

	return {
		source: mapCategoryRowToClientCategory(archivedSource[0] ?? source),
		target: mapCategoryRowToClientCategory(target),
		updatedTasks: updatedTasks.length,
		taskVersions: updatedTasks
	};
}

/**
 * @param {string} userId
 * @param {unknown} categoryId
 */
export async function deleteCategoryForUser(userId, categoryId) {
	const id = parseCategoryId(categoryId);
	const db = getDb();
	const board = await ensurePersonalBoardForUser(userId);
	const category = await getCategoryRowForBoard(db, board.id, id);
	if (!category) {
		throw new ApiError('Category was not found.', 404);
	}

	const now = new Date();
	const [clearedTasks, archivedCategory] = await db.batch([
		db
			.update(schema.tasks)
			.set({
				categoryId: null,
				category: '',
				updatedAt: now,
				version: sql`${schema.tasks.version} + 1`
			})
			.where(and(
				eq(schema.tasks.boardId, board.id),
				eq(schema.tasks.categoryId, category.id),
				isNull(schema.tasks.deletedAt)
			))
			.returning(TASK_VERSION_COLUMNS),
		db
			.update(schema.categories)
			.set({
				archivedAt: now,
				hiddenAt: now,
				updatedAt: now
			})
			.where(and(eq(schema.categories.id, category.id), eq(schema.categories.boardId, board.id)))
			.returning()
	]);

	return {
		category: mapCategoryRowToClientCategory(archivedCategory[0] ?? category),
		clearedTasks: clearedTasks.length,
		taskVersions: clearedTasks
	};
}

/**
 * @param {string} userId
 * @param {unknown} payload
 */
export async function reorderCategoriesForUser(userId, payload) {
	const source = readPayloadObject(payload);
	const categoryIds = Array.isArray(source.categoryIds)
		? source.categoryIds.map(parseCategoryId)
		: null;
	if (!categoryIds || categoryIds.length === 0) {
		throw new ApiError('categoryIds must be a non-empty array.');
	}

	const uniqueIds = [...new Set(categoryIds)];
	const db = getDb();
	const board = await ensurePersonalBoardForUser(userId);
	const existingRows = await db
		.select({ id: schema.categories.id })
		.from(schema.categories)
		.where(and(
			eq(schema.categories.boardId, board.id),
			inArray(schema.categories.id, uniqueIds),
			isNull(schema.categories.archivedAt)
		));
	if (existingRows.length !== uniqueIds.length) {
		throw new ApiError('One or more categories were not found.', 404);
	}

	const now = new Date();
	for (const [index, id] of uniqueIds.entries()) {
		await db
			.update(schema.categories)
			.set({ sortOrder: index, updatedAt: now })
			.where(and(eq(schema.categories.id, id), eq(schema.categories.boardId, board.id)))
			.returning({ id: schema.categories.id });
	}

	return listCategoriesForUser(userId);
}

/**
 * @param {unknown} payload
 */
function parseCategoryCreatePayload(payload) {
	const source = readPayloadObject(payload);
	const name = parseCategoryName(source.name);
	if (!name) {
		throw new ApiError('Category name is required.');
	}

	return {
		name,
		color: parseCategoryColor(source.color),
		hidden: parseOptionalBoolean(source.hidden, 'hidden')
	};
}

/**
 * @param {unknown} payload
 */
function parseCategoryPatchPayload(payload) {
	const source = readPayloadObject(payload);
	/** @type {{ name?: string; color?: string | null; hidden?: boolean; archived?: boolean }} */
	const patch = {};
	if (Object.prototype.hasOwnProperty.call(source, 'name')) {
		const name = parseCategoryName(source.name);
		if (!name) {
			throw new ApiError('Category name is required.');
		}
		patch.name = name;
	}
	if (Object.prototype.hasOwnProperty.call(source, 'color')) {
		patch.color = parseCategoryColor(source.color);
	}
	if (Object.prototype.hasOwnProperty.call(source, 'hidden')) {
		patch.hidden = parseOptionalBoolean(source.hidden, 'hidden') ?? false;
	}
	if (Object.prototype.hasOwnProperty.call(source, 'archived')) {
		patch.archived = parseOptionalBoolean(source.archived, 'archived') ?? false;
	}
	if (Object.keys(patch).length === 0) {
		throw new ApiError('At least one category field is required.');
	}
	return patch;
}

/**
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
function readPayloadObject(payload) {
	const source = /** @type {Record<string, unknown> | null} */ (payload);
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		throw new ApiError('Category payload must be an object.');
	}
	return source;
}

/**
 * @param {unknown} value
 */
function parseCategoryId(value) {
	if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
		throw new ApiError('Invalid categoryId.');
	}
	return value;
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function parseOptionalBoolean(value, label) {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'boolean') {
		throw new ApiError(`${label} must be a boolean.`);
	}
	return value;
}

/**
 * @param {unknown} error
 */
function isUniqueConstraintError(error) {
	return Boolean(
		error
		&& typeof error === 'object'
		&& 'message' in error
		&& typeof /** @type {{ message?: unknown }} */ (error).message === 'string'
		&& /** @type {{ message: string }} */ (error).message.includes('categories_board_normalized_name_uidx')
	);
}
