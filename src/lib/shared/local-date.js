/**
 * Calendar dates as the user sees them: `YYYY-MM-DD` in the device's local
 * time zone. `Date#toISOString()` is UTC, so in Korea it still shows
 * yesterday until 09:00; never use it for a date the user reads.
 */

/**
 * @param {number} value
 */
function padDatePart(value) {
	return `${value}`.padStart(2, '0');
}

/**
 * @param {Date} date
 * @returns {string} `YYYY-MM-DD` in local time
 */
export function formatLocalDate(date) {
	return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}
