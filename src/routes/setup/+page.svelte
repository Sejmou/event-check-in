<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let secondsLeft = $state(0);

	// The page's own query string has to survive the post, or the action can't
	// tell whose link this is. `?/name` alone would replace it.
	const action = (name: string) => `?${new URLSearchParams({ email: data.email })}&/${name}`;

	// Counted on the device from when the ticket arrived, not from the server's
	// expiry timestamp, so a phone clock that is off doesn't skew it.
	$effect(() => {
		const seconds = form?.ticketSeconds;
		if (!seconds) return;
		secondsLeft = seconds;
		const id = setInterval(() => {
			secondsLeft -= 1;
			if (secondsLeft <= 0) clearInterval(id);
		}, 1000);
		return () => clearInterval(id);
	});
</script>

<svelte:head><title>Check in</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
	<h1 class="text-2xl font-semibold">Hi, {data.firstName}!</h1>

	{#if secondsLeft > 0}
		<p class="text-gray-600" role="status">
			Scan the code at the door within <strong>{secondsLeft}</strong>
			{secondsLeft === 1 ? 'second' : 'seconds'}.
		</p>
	{:else}
		<p class="text-gray-600">
			Tap the button, then scan the code at the door within 30 seconds — with this phone, in this
			browser.
		</p>
	{/if}
	<form method="post" action={action('ticket')} use:enhance>
		<button class="w-full rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700">
			{secondsLeft > 0 ? 'Restart the 30 seconds' : 'Check in now'}
		</button>
	</form>
</main>
