<script lang="ts">
	import { enhance } from '$app/forms';
	import { authClient, canUsePasskey } from '$lib/auth-client';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let passkeySupported = $state<boolean | null>(null);
	let passkeyError = $state('');
	let registering = $state(false);
	let secondsLeft = $state(0);

	// The page's own query string has to survive the post, or the action can't
	// tell whose link this is. `?/name` alone would replace it.
	const action = (name: string) => `?${new URLSearchParams({ email: data.email })}&/${name}`;

	$effect(() => {
		canUsePasskey().then((ok) => (passkeySupported = ok));
	});

	// Counted on the device from when the ticket arrived, not from the server's
	// expiry timestamp, so a phone clock that is off doesn't skew it.
	$effect(() => {
		const seconds = form && 'ticketSeconds' in form ? form.ticketSeconds : undefined;
		if (!seconds) return;
		secondsLeft = seconds;
		const id = setInterval(() => {
			secondsLeft -= 1;
			if (secondsLeft <= 0) clearInterval(id);
		}, 1000);
		return () => clearInterval(id);
	});

	async function addPasskey() {
		registering = true;
		passkeyError = '';
		const result = await authClient.passkey.addPasskey();
		registering = false;

		if (result?.error) {
			passkeyError = 'That did not work. You can still check in with the button above.';
			return;
		}
		document.forms.namedItem('finishPasskey')?.requestSubmit();
	}
</script>

<svelte:head><title>Check in</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-8 p-6">
	<h1 class="text-2xl font-semibold">Hi, {data.firstName}!</h1>

	{#if form && 'passkeySaved' in form}
		<section class="flex flex-col gap-3">
			<h2 class="text-lg font-semibold">Passkey saved</h2>
			<p class="text-gray-600">
				You won't need this page again. At the door, scan the code on the screen and confirm with
				your passkey.
			</p>
		</section>
	{:else}
		<section class="flex flex-col gap-3">
			<h2 class="text-lg font-semibold">Check in now</h2>
			{#if secondsLeft > 0}
				<p class="text-gray-600" role="status">
					Scan the code at the door within <strong>{secondsLeft}</strong>
					{secondsLeft === 1 ? 'second' : 'seconds'}.
				</p>
			{:else}
				<p class="text-gray-600">
					Tap the button, then scan the code at the door within 30 seconds — with this phone, in
					this browser.
				</p>
			{/if}
			<form method="post" action={action('ticket')} use:enhance>
				<button
					class="w-full rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
				>
					{secondsLeft > 0 ? 'Restart the 30 seconds' : 'Check in now'}
				</button>
			</form>
		</section>

		<section class="flex flex-col gap-3">
			<h2 class="text-lg font-semibold">Or set up a passkey</h2>
			<p class="text-gray-600">
				{data.hasPasskey
					? 'You already have a passkey, so just scan the code at the door. Add another one here if you switched phones.'
					: 'Then you can skip this page: scan the code at the door and confirm with your fingerprint, face or screen lock.'}
			</p>
			{#if passkeySupported === false}
				<p class="text-sm text-gray-500">This device may not support passkeys.</p>
			{/if}

			{#if form && 'registering' in form}
				<button
					type="button"
					onclick={addPasskey}
					disabled={registering}
					class="rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
				>
					{registering ? 'Waiting for your device…' : 'Create the passkey'}
				</button>
			{:else}
				<form method="post" action={action('startPasskey')} use:enhance>
					<button
						class="w-full rounded-md border border-gray-300 px-4 py-2 transition hover:bg-gray-50"
					>
						Set up a passkey
					</button>
				</form>
			{/if}
		</section>

		<form
			method="post"
			action={action('finishPasskey')}
			name="finishPasskey"
			hidden
			use:enhance
		></form>
	{/if}

	<p class="text-sm text-red-600" role="alert">
		{passkeyError || (form && 'message' in form ? form.message : '')}
	</p>
</main>
