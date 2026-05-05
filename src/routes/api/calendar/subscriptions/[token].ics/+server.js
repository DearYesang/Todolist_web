import { createTaskCalendar } from '$lib/shared/calendar-ics.js';
import {
	CalendarTokenConfigurationError,
	getCalendarTasksForToken
} from '$lib/server/calendar/tokens.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ params }) {
	try {
		const tasks = await getCalendarTasksForToken(params.token);
		if (!tasks) {
			return new Response('Not found', { status: 404 });
		}

			return new Response(createTaskCalendar(tasks, { calendarName: 'Todolist' }), {
				headers: {
					'content-type': 'text/calendar;charset=utf-8',
					'cache-control': 'private, no-store',
					'x-robots-tag': 'noindex, nofollow, noarchive'
				}
			});
	} catch (error) {
		if (error instanceof CalendarTokenConfigurationError) {
			return new Response('Calendar token configuration is unavailable.', { status: 503 });
		}

		throw error;
	}
}
