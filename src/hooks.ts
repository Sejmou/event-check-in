import type { Reroute } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { deLocalizeUrl } from '$lib/paraglide/runtime';

export const reroute: Reroute = (request) => {
	// Paraglide's patterns put the locale right after the host (/en/login), so it
	// only recognises /check-in/en/login once the base path is out of the way.
	// SvelteKit wants the base back on what this returns.
	const base = resolve('/').slice(0, -1);
	const url = new URL(request.url);
	if (!url.pathname.startsWith(`${base}/`)) return url.pathname;

	url.pathname = url.pathname.slice(base.length);
	return base + deLocalizeUrl(url).pathname;
};
