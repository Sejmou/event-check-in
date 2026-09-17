<script lang="ts">
	import { resolve } from '$app/paths';
	import { fly } from 'svelte/transition';
	import QrScreen from '$lib/components/qr-screen.svelte';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	type Arrival = PageServerData['recent'][number];

	const TOAST_MS = 6_000;

	/** Arrivals pushed since the page loaded; `data.recent` catches up on each rotation. */
	let live = $state<Arrival[]>([]);
	let toasts = $state<Arrival[]>([]);

	const recent = $derived(
		[...live, ...data.recent]
			.filter((arrival, i, all) => all.findIndex((a) => a.id === arrival.id) === i)
			.sort((a, b) => b.at.getTime() - a.at.getTime())
			.slice(0, 5)
	);

	// Every check-in, as it happens, on the screen people are standing in front
	// of. A link or passkey used by the wrong person shows a name that isn't theirs.
	$effect(() => {
		const source = new EventSource(resolve('/admin/checkins/stream'));
		source.onmessage = (message) => {
			const event = JSON.parse(message.data);
			const arrival: Arrival = { ...event, at: new Date(event.at) };

			live = [arrival, ...live].slice(0, 5);
			toasts = [...toasts, arrival];
			setTimeout(() => (toasts = toasts.filter((t) => t.id !== arrival.id)), TOAST_MS);
		};
		return () => source.close();
	});

	const time = (at: Date) =>
		at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
</script>

<svelte:head><title>Check in</title></svelte:head>

<QrScreen title="Scan to check in" qr={data.qr} msUntilNextBucket={data.msUntilNextBucket}>
	<p class="text-gray-600">
		{data.present} of {data.expected} guests here. This code changes automatically — leave this page open.
	</p>

	<section class="w-full max-w-md">
		<h2 class="mb-2 text-sm font-medium text-gray-500">Last check-ins</h2>
		{#if recent.length === 0}
			<p class="text-gray-500">Nobody yet.</p>
		{:else}
			<ol class="divide-y divide-gray-100 rounded-lg border border-gray-200">
				{#each recent as arrival (arrival.id)}
					<li class="flex justify-between gap-4 px-3 py-2">
						<span>{arrival.firstName} {arrival.lastName}</span>
						<span class="text-gray-500 tabular-nums">{time(arrival.at)}</span>
					</li>
				{/each}
			</ol>
		{/if}
	</section>

	<div class="flex gap-4">
		<a href={resolve('/admin')} class="text-blue-600 underline">Guests</a>
		<a href={resolve('/admin/checkins')} class="text-blue-600 underline">Check-in log</a>
	</div>
</QrScreen>

<div
	class="pointer-events-none fixed top-4 right-4 left-4 flex flex-col items-end gap-2"
	aria-live="polite"
>
	{#each toasts as toast (toast.id)}
		<div
			transition:fly={{ x: 80 }}
			class="rounded-lg bg-green-600 px-5 py-3 text-lg text-white shadow-lg"
		>
			✓ {toast.firstName}
			{toast.lastName} checked in
		</div>
	{/each}
</div>
