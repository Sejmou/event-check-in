import type { RequestEvent } from '@sveltejs/kit';
import {
	HttpError,
	HttpMethod,
	LtijsError,
	type HttpHandler,
	type HttpRequestParameters,
	type HttpResponse,
	type RouteHandler
} from 'ltijs';

/**
 * Lets ltijs run inside SvelteKit instead of starting its own Express server
 * on a second port. ltijs registers its login, launch and keyset routes here;
 * `src/routes/lti-link/[...path]` hands matching requests over.
 *
 * Paths are relative to /lti-link (so `/launch`, not `/lti-link/launch`),
 * which keeps BASE_PATH out of it.
 */
export class SvelteKitHttpHandler implements HttpHandler {
	#routes = new Map<string, Map<string, RouteHandler>>();

	registerRoute(path: string, methods: HttpMethod[], handler: RouteHandler) {
		let byMethod = this.#routes.get(path);
		if (!byMethod) this.#routes.set(path, (byMethod = new Map()));
		for (const method of methods) byMethod.set(method, handler);
	}

	// Nothing to start or stop: SvelteKit owns the server.
	async listen() {}
	async close() {}

	/** The response for `path`, or null if ltijs has no route there. */
	async handle(event: RequestEvent, path: string): Promise<Response | null> {
		const byMethod = this.#routes.get(path);
		if (!byMethod) return null;
		const handler = byMethod.get(event.request.method) ?? byMethod.get(HttpMethod.All);
		if (!handler) return new Response(null, { status: 405 });

		const response = new BufferedResponse();
		try {
			await handler(await requestParameters(event, path), response);
		} catch (error) {
			return errorResponse(error);
		}
		return response.toResponse();
	}
}

async function requestParameters(
	event: RequestEvent,
	path: string
): Promise<HttpRequestParameters> {
	const { request, url } = event;

	const query: Record<string, string | string[]> = {};
	for (const key of new Set(url.searchParams.keys())) {
		const values = url.searchParams.getAll(key);
		query[key] = values.length === 1 ? values[0] : values;
	}

	// The platform posts the launch as a form (OIDC form_post), and so does the
	// page ltijs sends back to finish it.
	let body: Record<string, unknown> = {};
	const type = request.headers.get('content-type') ?? '';
	if (
		type.startsWith('application/x-www-form-urlencoded') ||
		type.startsWith('multipart/form-data')
	) {
		body = Object.fromEntries(await request.formData());
	} else if (type.startsWith('application/json')) {
		body = await request.json();
	}

	return {
		method: request.method,
		path,
		query,
		body,
		// Lower-cased by Headers already, as ltijs expects (it reads sec-fetch-site).
		headers: Object.fromEntries(request.headers)
	};
}

/** Collects what ltijs writes, since a Response can't be built up piece by piece. */
class BufferedResponse implements HttpResponse {
	#status = 200;
	#response: Response | undefined;

	status(code: number) {
		this.#status = code;
		return this;
	}

	redirect(url: string) {
		// 303: the launch arrives as a POST, and what follows is a page to GET.
		this.#response = new Response(null, { status: 303, headers: { location: url } });
	}

	html(content: string) {
		this.#response = new Response(content, {
			status: this.#status,
			headers: { 'content-type': 'text/html; charset=utf-8' }
		});
	}

	json(body: unknown) {
		this.#response = Response.json(body, { status: this.#status });
	}

	toResponse() {
		if (this.#response) return this.#response;
		console.error('ltijs: a route finished without sending a response');
		return new Response(null, { status: 500 });
	}
}

/** Mirrors ltijs's own Express handler, so errors look the same as they would there. */
function errorResponse(error: unknown) {
	console.error('ltijs:', error);
	if (error instanceof LtijsError) {
		return Response.json({ error: error.name, message: error.message }, { status: 400 });
	}
	if (error instanceof HttpError) {
		return Response.json(
			{ error: error.name, message: error.message, external: true },
			{ status: error.status ?? 502 }
		);
	}
	return Response.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
}
