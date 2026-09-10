<script lang="ts">
	import { enhance } from '$app/forms';
	import { authClient, canUsePasskey } from '$lib/auth-client';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let passkeySupported = $state<boolean | null>(null);
	let usePasswordAnyway = $state(false);
	let passkeyError = $state('');
	let confirming = $state(false);

	$effect(() => {
		canUsePasskey().then((ok) => (passkeySupported = ok));
	});

	const time = (at: Date) =>
		new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

	async function confirmWithPasskey() {
		confirming = true;
		passkeyError = '';
		const { error } = (await authClient.signIn.passkey()) ?? {};
		confirming = false;

		if (error) {
			passkeyError = 'That passkey did not work. Use your password instead.';
			usePasswordAnyway = true;
			return;
		}
		document.forms.namedItem('withPasskey')?.requestSubmit();
	}
</script>

<svelte:head><title>Check in</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
	{#if data.checkedIn}
		<h1 class="text-2xl font-semibold">You're checked in</h1>
		<p class="text-gray-600">
			{data.user?.firstName}, at {time(data.lastCheckIn!.at)}. Enjoy the event.
		</p>
	{:else if !data.present}
		<h1 class="text-2xl font-semibold">Scan the code at the door</h1>
		<p class="text-gray-600">
			This page opens when you scan the QR code on the check-in screen. The code changes every 30
			seconds, so scan the one showing now.
		</p>
	{:else}
		<h1 class="text-2xl font-semibold">Confirm it's you</h1>
		{#if data.lastCheckIn}
			<p class="text-sm text-gray-500">Last checked in at {time(data.lastCheckIn.at)}.</p>
		{/if}

		{#if passkeySupported === null}
			<p class="text-gray-600">Checking what this device supports…</p>
		{:else if passkeySupported && !usePasswordAnyway}
			<p class="text-gray-600">Use your fingerprint, face or screen lock.</p>
			<button
				type="button"
				onclick={confirmWithPasskey}
				disabled={confirming}
				class="rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
			>
				{confirming ? 'Waiting for your device…' : 'Check in with a passkey'}
			</button>
			<!-- The support check misreports on private-mode browsers and managed
			     devices, so never let it be the only way forward. -->
			<button
				type="button"
				onclick={() => (usePasswordAnyway = true)}
				class="text-sm text-gray-500 underline"
			>
				Use a password instead
			</button>
		{:else}
			<p class="text-gray-600">Sign in to check in.</p>
			<form method="post" action="?/withPassword" use:enhance class="flex flex-col gap-4">
				<label class="flex flex-col gap-1">
					Email
					<input
						type="email"
						name="email"
						autocomplete="username webauthn"
						value={data.user?.email ?? ''}
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
				<button class="rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700">
					Check in
				</button>
			</form>
			{#if passkeySupported}
				<button
					type="button"
					onclick={() => (usePasswordAnyway = false)}
					class="text-sm text-gray-500 underline"
				>
					Back to passkeys
				</button>
			{/if}
		{/if}

		<form method="post" action="?/withPasskey" name="withPasskey" hidden use:enhance></form>
	{/if}

	<p class="text-sm text-red-600" role="alert">{passkeyError || form?.message || ''}</p>
</main>
