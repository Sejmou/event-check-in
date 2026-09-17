<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let passkeyError = $state('');
	let signingIn = $state(false);

	async function signInWithPasskey() {
		signingIn = true;
		passkeyError = '';
		const { error } = (await authClient.signIn.passkey()) ?? {};
		signingIn = false;

		if (error) {
			passkeyError = 'That passkey did not work. Use your password instead.';
			return;
		}
		// Through / rather than straight to /admin: it sends admins on and signs a
		// leftover guest passkey back out.
		await goto(resolve('/'), { invalidateAll: true });
	}
</script>

<svelte:head><title>Sign in</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
	<h1 class="text-2xl font-semibold">Organizer sign-in</h1>

	<button
		type="button"
		onclick={signInWithPasskey}
		disabled={signingIn}
		class="rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
	>
		{signingIn ? 'Waiting for your device…' : 'Sign in with a passkey'}
	</button>

	<div class="flex items-center gap-3 text-sm text-gray-500">
		<hr class="flex-1 border-gray-300" />
		or
		<hr class="flex-1 border-gray-300" />
	</div>

	<form method="post" action="?/signInEmail" use:enhance class="flex flex-col gap-4">
		<label class="flex flex-col gap-1">
			Email
			<input
				type="email"
				name="email"
				autocomplete="username webauthn"
				required
				class="rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
			/>
		</label>
		<label class="flex flex-col gap-1">
			Password
			<input
				type="password"
				name="password"
				autocomplete="current-password"
				required
				class="rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
			/>
		</label>
		<button class="rounded-md border border-gray-300 px-4 py-2 transition hover:bg-gray-50">
			Sign in with a password
		</button>
	</form>

	<p class="text-sm text-red-600" role="alert">{passkeyError || form?.message || ''}</p>
</main>
