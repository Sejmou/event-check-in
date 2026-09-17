import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';
import { resolve } from '$app/paths';
import type { Pathname } from '$app/types';

// Vanilla client: every call here is imperative (an organizer registering a
// passkey, signing in with one). Nothing needs the reactive session store.
// basePath: the default /api/auth is at the domain root, outside a sub-path deploy.
export const authClient = createAuthClient({
	basePath: resolve('/api/auth' as Pathname),
	plugins: [passkeyClient()]
});
