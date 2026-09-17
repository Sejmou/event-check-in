<script lang="ts">
	import { enhance } from '$app/forms';
	import { authClient } from '$lib/auth-client';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let passkeyError = $state('');
	let confirming = $state(false);

	const checkedIn = $derived(form && 'checkedIn' in form ? form.checkedIn : null);

	// A ticket from /setup needs no further input, so hand it straight back.
	// Posted rather than redeemed in load, so a GET never writes a check-in.
	$effect(() => {
		if (data.present && data.hasTicket && !form) {
			document.forms.namedItem('withTicket')?.requestSubmit();
		}
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
	{:else if !data.present}
		<h1 class="text-2xl font-semibold">Scan the code at the door</h1>
		<p class="text-gray-600">
			This page opens when you scan the QR code on the check-in screen. The code changes every 30
			seconds, so scan the one showing now.
		</p>
	{:else if data.hasTicket && !form}
		<h1 class="text-2xl font-semibold">Checking you in…</h1>
		<form method="post" action="?/withTicket" name="withTicket" use:enhance>
			<noscript>
				<button class="rounded-md bg-blue-600 px-4 py-2 text-white">Check in</button>
			</noscript>
		</form>
	{:else}
		<h1 class="text-2xl font-semibold">Open your personal link</h1>
		<p class="text-gray-600">
			Open the personal link from your invitation, tap "Check in now", and scan the code again
			within 30 seconds.
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
