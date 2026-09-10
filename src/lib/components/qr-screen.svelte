<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { Snippet } from 'svelte';

	let {
		title,
		qr,
		msUntilNextBucket,
		children
	}: { title: string; qr: string; msUntilNextBucket: number; children: Snippet } = $props();

	// The code is derived from the clock, so refetch exactly when it rolls over
	// rather than on a fixed interval that would drift out of step with it.
	$effect(() => {
		const id = setTimeout(() => invalidateAll(), msUntilNextBucket);
		return () => clearTimeout(id);
	});
</script>

<main class="mx-auto flex min-h-svh max-w-2xl flex-col items-center justify-center gap-6 p-6">
	<h1 class="text-3xl font-semibold">{title}</h1>

	<!-- eslint-disable-next-line svelte/no-at-html-tags -- our own server-rendered SVG -->
	<div class="rounded-xl bg-white p-4 shadow-sm">{@html qr}</div>

	<div
		class="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-gray-200"
		role="progressbar"
		aria-label="Time until this code changes"
	>
		{#key msUntilNextBucket}
			<div
				class="h-full bg-blue-600"
				style="animation: countdown {msUntilNextBucket}ms linear forwards"
			></div>
		{/key}
	</div>

	{@render children()}
</main>

<style>
	@keyframes countdown {
		from {
			width: 100%;
		}
		to {
			width: 0%;
		}
	}
</style>
