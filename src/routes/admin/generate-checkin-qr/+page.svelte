<script lang="ts">
	import { resolve } from '$app/paths';
	import QrScreen from '$lib/components/qr-screen.svelte';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<svelte:head><title>Check in</title></svelte:head>

<QrScreen title="Scan to check in" qr={data.qr} msUntilNextBucket={data.msUntilNextBucket}>
	<p class="text-gray-600">
		{data.present} of {data.expected} guests here. This code changes automatically — leave this page open.
	</p>
	<a href={resolve('/admin')} class="text-blue-600 underline">Show the account setup code</a>
</QrScreen>
