<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<svelte:head><title>Event check-in</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
	<h1 class="text-2xl font-semibold">Hi, {data.user.firstName}!</h1>
	{#if data.lastCheckIn}
		<p class="text-gray-600">
			Checked in at {new Date(data.lastCheckIn.at).toLocaleTimeString(undefined, {
				hour: '2-digit',
				minute: '2-digit'
			})}.
		</p>
	{:else}
		<p class="text-gray-600">Your account is ready. Scan the code at the door to check in.</p>
	{/if}

	{#if data.user.role === 'admin'}
		<a href={resolve('/admin')} class="text-blue-600 underline">Open the check-in desk</a>
	{/if}

	<form method="post" action="?/signOut" use:enhance>
		<button class="rounded-md border border-gray-300 px-4 py-2 transition hover:bg-gray-50">
			Sign out
		</button>
	</form>
</main>
