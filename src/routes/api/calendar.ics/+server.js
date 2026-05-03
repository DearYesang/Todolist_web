import { requireAuthUser } from '$lib/server/auth/session.js';
import { listTasksForUser } from '$lib/server/tasks/repository.js';
import { createTaskCalendar } from '$lib/shared/calendar-ics.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request }) {
	const authResult = await requireAuthUser(request);
	if (!authResult.ok) {
		return authResult.response;
	}

	const tasks = await listTasksForUser(authResult.user.id);
	const calendar = createTaskCalendar(tasks, {
		calendarName: 'Todolist'
	});

	return new Response(calendar, {
		headers: {
			'content-type': 'text/calendar;charset=utf-8',
			'content-disposition': 'attachment; filename="todolist_calendar.ics"',
			'cache-control': 'private, no-store'
		}
	});
}
