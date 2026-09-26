import { expect } from '@playwright/test';

/**
 * Returns the locator's bounding box after asserting that it has one.
 * @param {import('@playwright/test').Locator} locator
 */
export async function boxOf(locator) {
	const box = await locator.boundingBox();
	expect(box).toBeTruthy();
	return /** @type {NonNullable<typeof box>} */ (box);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} card
 * @param {{ x: number; y: number }} dropPoint
 */
export async function pointerDrag(page, card, dropPoint) {
	await card.scrollIntoViewIfNeeded();
	const cardBox = await boxOf(card);

	// Pointer-based drag: press, cross the activation threshold, drop.
	await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 12);
	await page.mouse.down();
	await page.mouse.move(cardBox.x + cardBox.width / 2 + 30, cardBox.y + 44, { steps: 5 });
	await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 10 });
	await page.mouse.up();
}

/**
 * Records every alert/confirm text. Confirms take the next queued answer
 * (dismissed when none is left); alerts are just closed.
 * @param {import('@playwright/test').Page} page
 * @param {boolean[]} [confirmAnswers]
 */
export function recordDialogs(page, confirmAnswers = []) {
	/** @type {string[]} */
	const dialogs = [];
	page.on('dialog', (dialog) => {
		dialogs.push(`${dialog.type()}:${dialog.message()}`);
		if (dialog.type() === 'confirm' && confirmAnswers.shift()) {
			void dialog.accept();
		} else {
			void dialog.dismiss();
		}
	});
	return dialogs;
}
