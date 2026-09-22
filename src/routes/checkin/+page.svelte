<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { authClient } from '$lib/auth-client';
	import { checkInMessage, loadDeviceKey, sign } from '$lib/device-key';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let passkeyError = $state('');
	let confirming = $state(false);
	// null until this browser has looked for its key.
	let hasDeviceKey = $state<boolean | null>(null);
	let keyId = $state('');
	let signature = $state('');

	const checkedIn = $derived(form && 'checkedIn' in form ? form.checkedIn : null);

	// A set-up phone needs no further input: sign this scan and hand it straight
	// back. Posted rather than redeemed in load, so a GET never writes a check-in.
	$effect(() => {
		const scan = data.scanId;
		if (!scan || form) return;
		void (async () => {
			const key = await loadDeviceKey().catch(() => undefined);
			hasDeviceKey = Boolean(key);
			if (!key) return;
			keyId = key.keyId;
			signature = await sign(key.privateKey, checkInMessage(scan));
			await tick();
			document.forms.namedItem('withDeviceKey')?.requestSubmit();
		})();
	});

	async function confirmWithPasskey() {
		confirming = true;
		passkeyError = '';
		const { error } = (await authClient.signIn.passkey()) ?? {};
		confirming = false;

		if (error) {
			passkeyError = 'That passkey did not work.';
			return;
		}
		document.forms.namedItem('withPasskey')?.requestSubmit();
	}
</script>

<svelte:head><title>Check in</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
	{#if checkedIn}
		<h1 class="text-2xl font-semibold">You're checked in</h1>
		<p class="text-gray-600">
			Welcome, {checkedIn}. Enjoy the event.
		</p>
	{:else if !data.scanId}
		<h1 class="text-2xl font-semibold">Scan the code at the door</h1>
		<p class="text-gray-600">
			This page opens when you scan the QR code on the check-in screen. The code changes every 30
			seconds, so scan the one showing now.
		</p>
	{:else if hasDeviceKey !== false && !form}
		<h1 class="text-2xl font-semibold">Checking you in…</h1>
		<form method="post" action="?/withDeviceKey" name="withDeviceKey" use:enhance>
			<input type="hidden" name="keyId" value={keyId} />
			<input type="hidden" name="signature" value={signature} />
		</form>
	{:else if hasDeviceKey}
		<!-- The key was there and was turned down; the message below says why. -->
		<h1 class="text-2xl font-semibold">That didn't work</h1>
	{:else}
		<h1 class="text-2xl font-semibold">Set up this phone first</h1>
		<p class="text-gray-600">
			Open the check-in activity in your Moodle course on this phone and tap "Set up this phone".
			Then scan the code again.
		</p>
		<button
			type="button"
			onclick={confirmWithPasskey}
			disabled={confirming}
			class="self-start text-sm text-gray-500 underline disabled:opacity-50"
		>
			{confirming ? 'Waiting for your device…' : 'Organizer? Check in with your passkey'}
		</button>

		<form method="post" action="?/withPasskey" name="withPasskey" hidden use:enhance></form>
	{/if}

	<p class="text-sm text-red-600" role="alert">
		{passkeyError || (form && 'message' in form ? form.message : '')}
	</p>
</main>
