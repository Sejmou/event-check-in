import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';

// Vanilla client: every call here is imperative (an organizer registering a
// passkey, signing in with one). Nothing needs the reactive session store.
export const authClient = createAuthClient({ plugins: [passkeyClient()] });
