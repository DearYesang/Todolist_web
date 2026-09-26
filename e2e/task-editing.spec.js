import { expect, test } from '@playwright/test';
import { cardByTitle, readPersistedTask, seedOfflineBoard } from './fixtures/board.js';

test('suggests categories and manages category names offline', async ({ page }) => {
	await seedOfflineBoard(page);

	await page.goto('/');
	await page.getByRole('button', { name: /새 작업 추가/ }).click();
	await page.getByLabel('작업명').fill('네트워크 개념 공부');
	await page.getByRole('button', { name: /CS 공부/ }).click();
	await expect(page.getByLabel('카테고리')).toHaveValue('CS 공부');
	await page.getByRole('button', { name: /작업 추가/ }).click();

	await expect(page.getByText('네트워크 개념 공부')).toBeVisible();
	await page.getByRole('button', { name: '관리' }).click();
	await expect(page.getByRole('dialog', { name: '카테고리 관리' })).toBeVisible();

	const categoryRow = page.locator('.category-manager-row', { hasText: 'CS 공부' });
	await expect(categoryRow).toContainText('1 진행');
	await categoryRow.getByRole('button', { name: '이름 변경' }).click();
	await page.locator('.category-rename-input').fill('공부');
	await page.getByRole('button', { name: '저장' }).click();

	await expect(page.locator('.category-manager-row', { hasText: '공부' })).toBeVisible();
	await page.getByRole('dialog', { name: '카테고리 관리' }).getByRole('button', { name: '✕' }).click();
	await expect(page.getByRole('dialog', { name: '카테고리 관리' })).toBeHidden();
	await expect(page.locator('.category-tag', { hasText: '공부' }).first()).toBeVisible();
});

/**
 * Plays the event sequence a Korean IME produces around the Enter that
 * confirms the last syllable. Playwright cannot drive a real IME, so this
 * only checks how the inputs react to those events; the real thing needs a
 * manual check with the Korean keyboard on a Mac and an iPhone.
 * @param {import('@playwright/test').Locator} input
 */
async function pressEnterThroughImeComposition(input) {
	await input.evaluate((node) => {
		const enter = (init = {}) => node.dispatchEvent(new KeyboardEvent('keydown', {
			key: 'Enter',
			bubbles: true,
			cancelable: true,
			...init
		}));
		node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		enter({ isComposing: true });
		// Some engines report the composing Enter without isComposing.
		enter();
		node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		// The confirming Enter's keydown right after compositionend.
		enter();
	});
}

/**
 * @param {import('@playwright/test').Locator} input
 */
async function pressEnterOnNextTask(input) {
	await input.evaluate(async (node) => {
		await new Promise((resolve) => setTimeout(resolve, 0));
		node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	});
}

test('does not submit the Enter that confirms an IME composition', async ({ page }) => {
	await seedOfflineBoard(page);
	await page.goto('/');

	const card = cardByTitle(page, 'E2E cached task');
	const checklistInput = card.locator('.add-subtask-input');
	await checklistInput.fill('한글 항목');
	await pressEnterThroughImeComposition(checklistInput);
	await expect(card.locator('.subtask-item')).toHaveCount(2);
	await expect(checklistInput).toHaveValue('한글 항목');
	// A later, separate Enter adds the item exactly once.
	await pressEnterOnNextTask(checklistInput);
	await expect(card.locator('.subtask-item')).toHaveCount(3);
	await expect(card.locator('.subtask-text').nth(2)).toHaveText('한글 항목');
	await expect(checklistInput).toHaveValue('');

	await page.getByRole('button', { name: /새 작업 추가/ }).click();
	const titleInput = page.locator('#task-text');
	await titleInput.fill('한글 작업');
	await pressEnterThroughImeComposition(titleInput);
	await expect(titleInput).toHaveValue('한글 작업');
	await expect(page.locator('.card-text', { hasText: '한글 작업' })).toHaveCount(0);
	await pressEnterOnNextTask(titleInput);
	await expect(page.locator('.card-text', { hasText: '한글 작업' })).toHaveCount(1);
});

test('narrows every view with the search box and highlights overdue work', async ({ page }) => {
	await seedOfflineBoard(page);

	await page.goto('/');
	await page.getByLabel('작업 검색').fill('Urgent');

	await expect(page.getByText('Urgent important')).toBeVisible();
	await expect(page.getByText('E2E cached task')).toBeHidden();

	await page.getByRole('button', { name: '검색 지우기' }).click();
	await expect(page.getByText('E2E cached task')).toBeVisible();
});

test('asks the same delete question on a card and in the detail panel', async ({ page }) => {
	await seedOfflineBoard(page);
	await page.goto('/');

	/** @type {string[]} */
	const questions = [];
	page.on('dialog', (dialog) => {
		questions.push(`${dialog.type()}:${dialog.message()}`);
		void dialog.dismiss();
	});

	const modal = page.locator('.side-panel');
	const parentCard = cardByTitle(page, 'Nested parent task');
	await parentCard.getByRole('button', { name: 'Nested parent task 삭제', exact: true }).click();
	await parentCard.locator('.card-text').click();
	await modal.getByRole('button', { name: /작업 삭제/ }).click();
	await modal.locator('.close-btn').click();
	await expect(modal).toHaveCount(0);

	const childCard = cardByTitle(page, 'Nested child task');
	await childCard.getByRole('button', { name: 'Nested child task 삭제', exact: true }).click();
	await childCard.locator('.card-text').click();
	await modal.getByRole('button', { name: /작업 삭제/ }).click();

	const withChildren = 'confirm:이 작업에는 1개의 하위 작업이 있습니다.\n모두 함께 삭제하시겠습니까?';
	const leaf = 'confirm:이 작업을 삭제하시겠습니까?';
	await expect.poll(() => questions).toEqual([withChildren, withChildren, leaf, leaf]);
	// Dismissing the question deletes nothing and keeps the panel open.
	await expect(modal).toBeVisible();
	await expect(parentCard).toBeVisible();
	await expect(childCard).toBeVisible();
});

test('shows the card labels for status, priority and urgency in the detail panel', async ({ page }) => {
	await seedOfflineBoard(page, {
		extraTasks: [{ id: 'local-low-done', text: 'Low priority finished task', status: 'done', priority: 'low', urgency: 'normal' }]
	});
	await page.goto('/');

	const modal = page.locator('.side-panel');
	/** @type {Array<[string, [string, string, string], [string, string, string]]>} */
	const cases = [
		['Urgent important', ['할 일', '🔴 높음', '🔥 시급'], ['todo', 'high', 'urgent']],
		['Planned important', ['진행 중', '🔴 높음', '⏳ 여유'], ['doing', 'high', 'normal']],
		['E2E cached task', ['할 일', '🟡 보통', '⏳ 여유'], ['todo', 'medium', 'normal']],
		['Low priority finished task', ['완료', '🟢 낮음', '⏳ 여유'], ['done', 'low', 'normal']]
	];

	for (const [title, [status, priority, urgency], [statusValue, priorityValue, urgencyValue]] of cases) {
		const card = cardByTitle(page, title);
		await expect(card.locator('.priority-badge')).toHaveText(priority);
		await expect(card.locator('.urgency-badge')).toHaveText(urgency);

		await card.locator('.card-text').click();
		await expect(modal).toBeVisible();
		expect(await modal.locator('.summary-row .summary-chip').evaluateAll((chips) =>
			chips.slice(0, 3).map((chip) => chip.textContent)
		)).toEqual([status, priority, urgency]);
		await expect(modal.locator('#modal-status')).toHaveValue(statusValue);
		await expect(modal.locator('#modal-priority')).toHaveValue(priorityValue);
		await expect(modal.locator('#modal-urgency')).toHaveValue(urgencyValue);

		expect(await modal.locator('#modal-status option').evaluateAll((options) =>
			options.map((option) => [option.getAttribute('value'), option.textContent])
		)).toEqual([['todo', '할 일'], ['doing', '진행 중'], ['done', '완료']]);
		expect(await modal.locator('#modal-priority option').evaluateAll((options) =>
			options.map((option) => [option.getAttribute('value'), option.textContent])
		)).toEqual([['high', '🔴 높음'], ['medium', '🟡 보통'], ['low', '🟢 낮음']]);
		expect(await modal.locator('#modal-urgency option').evaluateAll((options) =>
			options.map((option) => [option.getAttribute('value'), option.textContent])
		)).toEqual([['urgent', '🔥 시급'], ['normal', '⏳ 여유']]);

		await modal.locator('.close-btn').click();
		await expect(modal).toHaveCount(0);
	}

	// The selects still edit the task and the chips follow.
	await cardByTitle(page, 'E2E cached task').locator('.card-text').click();
	await modal.locator('#modal-priority').selectOption('low');
	await modal.locator('#modal-urgency').selectOption('urgent');
	await expect(modal.locator('.priority-chip')).toHaveText('🟢 낮음');
	await expect(modal.locator('.urgency-chip')).toHaveText('🔥 시급');
	await expect(modal.locator('#modal-priority')).toHaveValue('low');
	await modal.locator('.close-btn').click();
	await expect(cardByTitle(page, 'E2E cached task').locator('.priority-badge')).toHaveText('🟢 낮음');
});

test('saves a category typed in the detail panel when the field is left or Enter is pressed', async ({ page }) => {
	const categoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
	await seedOfflineBoard(page, {
		extraTasks: [{
			id: 'local-categorized-task',
			text: 'Categorized task',
			category: '개발',
			categoryId,
			categoryMeta: { id: categoryId, name: '개발', color: '#ff0000', sortOrder: 0, hiddenAt: null, archivedAt: null }
		}]
	});
	await page.goto('/');

	const card = cardByTitle(page, 'Categorized task');
	const modal = page.locator('.side-panel');
	const input = modal.locator('#modal-category');
	await expect(card.locator('.category-tag')).toHaveText('개발');
	await card.locator('.card-text').click();
	await expect(input).toHaveValue('개발');

	// Typing keeps what is typed, spaces included, and saves nothing yet.
	await input.fill('');
	await input.pressSequentially('신규 기획');
	await expect(input).toHaveValue('신규 기획');
	await expect(modal.locator('.category-chip')).toHaveText('개발');

	await input.blur();
	await expect(modal.locator('.category-chip')).toHaveText('신규 기획');
	await modal.locator('.close-btn').click();
	await expect(card.locator('.category-tag')).toHaveText('신규 기획');
	expect(await readPersistedTask(page, 'local-categorized-task')).toMatchObject({
		category: '신규 기획',
		categoryId: null,
		categoryMeta: null
	});

	await card.locator('.card-text').click();
	await expect(input).toHaveValue('신규 기획');
	await input.fill('리서치');
	await input.press('Enter');
	await expect(modal.locator('.category-chip')).toHaveText('리서치');
	await expect(input).toHaveValue('리서치');
});

test('saves a category typed in the detail panel when the panel is closed with Escape', async ({ page }) => {
	const categoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
	await seedOfflineBoard(page, {
		extraTasks: [
			{
				id: 'local-categorized-task',
				text: 'Task in a category',
				category: '개발',
				categoryId,
				categoryMeta: { id: categoryId, name: '개발', color: '#ff0000', sortOrder: 0, hiddenAt: null, archivedAt: null }
			},
			{ id: 'local-uncategorized-task', text: 'Task without a category' }
		]
	});
	await page.goto('/');

	const modal = page.locator('.side-panel');
	const input = modal.locator('#modal-category');
	for (const [title, category] of [['Task in a category', '프로브'], ['Task without a category', '리서치']]) {
		const card = cardByTitle(page, title);
		await card.locator('.card-text').click();
		await input.fill('');
		await input.pressSequentially(category);
		// Escape closes the panel with the field still focused; the name
		// typed there is saved like the title typed above it.
		await input.press('Escape');
		await expect(modal).toHaveCount(0);
		await expect(card.locator('.category-tag')).toHaveText(category);
	}
});
