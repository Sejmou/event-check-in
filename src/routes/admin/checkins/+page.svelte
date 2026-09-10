<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const when = (at: Date) =>
		new Date(at).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});

	// The full string is in the title attribute; the table is for scanning.
	const device = (userAgent: string | null) =>
		userAgent
			?.match(/\((.*?)\)/)?.[1]
			?.split(';')[0]
			?.trim() ??
		userAgent?.slice(0, 24) ??
		'—';
</script>

<svelte:head><title>Check-in log</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-5xl flex-col gap-6 p-6">
	<div class="flex flex-wrap items-baseline justify-between gap-3">
		<h1 class="text-2xl font-semibold">Check-in log</h1>
		<a href={resolve('/admin/generate-checkin-qr')} class="text-blue-600 underline">
			Show the check-in code
		</a>
	</div>

	<p class="text-gray-600">
		{data.rows.length} check-ins · {data.guests} guests · {data.addresses} addresses
	</p>

	{#if data.rows.length === 0}
		<p class="text-gray-500">Nobody has checked in yet.</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full border-collapse text-left text-sm">
				<thead class="border-b border-gray-300 text-gray-600">
					<tr>
						<th class="py-2 pr-4 font-medium">When</th>
						<th class="py-2 pr-4 font-medium">Guest</th>
						<th class="py-2 pr-4 font-medium">Confirmed with</th>
						<th class="py-2 pr-4 font-medium">Address</th>
						<th class="py-2 pr-4 font-medium">Device</th>
						<th class="py-2 font-medium">Scan</th>
					</tr>
				</thead>
				<tbody>
					{#each data.rows as row (row.scanId + row.userId)}
						<tr class="border-b border-gray-100">
							<td class="py-2 pr-4 whitespace-nowrap">{when(row.at)}</td>
							<td class="py-2 pr-4">
								{row.firstName}
								{row.lastName}
								<span class="block text-xs text-gray-500">{row.email}</span>
							</td>
							<td class="py-2 pr-4">{row.method}</td>
							<td class="py-2 pr-4 whitespace-nowrap">
								{row.ipAddress ?? '—'}
								{#if row.sharedAddress}
									<span
										class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
										title="More than one guest checked in from this address"
									>
										shared
									</span>
								{/if}
							</td>
							<td class="py-2 pr-4" title={row.userAgent ?? ''}>{device(row.userAgent)}</td>
							<td class="py-2 font-mono text-xs text-gray-500">
								{row.scanId}
								{#if row.repeat}
									<span
										class="ml-1 rounded bg-gray-100 px-1.5 py-0.5 font-sans text-xs text-gray-600"
										title="This guest had already checked in earlier"
									>
										again
									</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<p class="text-sm text-gray-500">
			Neither flag is wrong on its own — guests step out and come back, and a whole table shares one
			hotspot. A code that leaked looks like many guests on one address who never passed the desk.
		</p>
	{/if}
</main>
