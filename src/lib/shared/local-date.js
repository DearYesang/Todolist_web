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

/**
 * @param {Date} [now]
 * @returns {string} today's local `YYYY-MM-DD`
 */
export function todayString(now = new Date()) {
	return formatLocalDate(now);
}

/**
 * Local NOON on a `YYYY-MM-DD` date. Day arithmetic and comparisons start
 * from noon so a DST shift can never move them onto the neighbouring day.
 * No validation: a malformed string gives an Invalid Date, so validate
 * untrusted input first (task-domain's normalizeDateRange does).
 * @param {string} dateString
 */
export function parseLocalDateNoon(dateString) {
	return new Date(`${dateString}T12:00:00`);
}

/**
 * @param {string} dateString `YYYY-MM-DD`
 * @param {number} offset calendar days, may be negative
 * @returns {string} `YYYY-MM-DD`
 */
export function addDays(dateString, offset) {
	const date = parseLocalDateNoon(dateString);
	date.setDate(date.getDate() + offset);
	return formatLocalDate(date);
}
