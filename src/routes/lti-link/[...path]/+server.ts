import { error } from '@sveltejs/kit';
import { httpHandler } from '$lib/server/lti/provider';
import type { RequestHandler } from './$types';

/**
 * Everything under /lti-link that isn't a page of ours belongs to ltijs: the
 * login Moodle starts a launch with, the launch itself, and the keyset Moodle
 * verifies the tool's signatures against.
 */
const handle: RequestHandler = async (event) => {
	const response = await httpHandler.handle(event, `/${event.params.path}`);
	if (!response) error(404, 'Not found');
	return response;
};

export const GET = handle;
export const POST = handle;
