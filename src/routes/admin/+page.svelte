<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	let copied = $state('');

	async function copy(url: string) {
		await navigator.clipboard.writeText(url);
		copied = url;
	}
</script>

<svelte:head><title>Guests</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-5xl flex-col gap-6 p-6">
	<div class="flex flex-wrap items-baseline justify-between gap-3">
		<h1 class="text-2xl font-semibold">Guests</h1>
		<div class="flex flex-wrap items-baseline gap-4">
			<a href={resolve('/admin/generate-checkin-qr')} class="text-blue-600 underline">
				Show the check-in code
			</a>
			<a href={resolve('/admin/checkins')} class="text-blue-600 underline">Check-in log</a>
			<form method="post" action="?/signOut" use:enhance>
				<button class="text-gray-500 underline">Sign out</button>
			</form>
		</div>
	</div>

	<p class="text-gray-600">
		Send each guest their personal link. Anyone holding it can check that guest in, so treat it like
		the invitation itself — the check-in screen shows every name as it happens.
	</p>

	<div class="overflow-x-auto">
		<table class="w-full border-collapse text-left text-sm">
			<thead class="border-b border-gray-300 text-gray-600">
				<tr>
					<th class="py-2 pr-4 font-medium">Guest</th>
					<th class="py-2 pr-4 font-medium">Passkey</th>
					<th class="py-2 font-medium">Personal link</th>
				</tr>
			</thead>
			<tbody>
				{#each data.guests as guest (guest.id)}
					<tr class="border-b border-gray-100">
						<td class="py-2 pr-4">
							{guest.firstName}
							{guest.lastName}
							<span class="block text-xs text-gray-500">{guest.email}</span>
						</td>
						<td class="py-2 pr-4">{guest.passkeys > 0 ? 'yes' : '—'}</td>
						<td class="py-2">
							<button
								type="button"
								onclick={() => copy(guest.setupUrl)}
								class="rounded border border-gray-300 px-2 py-0.5 text-xs transition hover:bg-gray-50"
							>
								{copied === guest.setupUrl ? 'Copied' : 'Copy'}
							</button>
							<span class="ml-2 font-mono text-xs break-all text-gray-500">{guest.setupUrl}</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</main>
