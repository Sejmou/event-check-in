<script lang="ts">
	import { resolve } from '$app/paths';
	import QrScreen from '$lib/components/qr-screen.svelte';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<svelte:head><title>Check-in desk</title></svelte:head>

<QrScreen
	title="Scan to set up your account"
	qr={data.qr}
	msUntilNextBucket={data.msUntilNextBucket}
>
	<p class="text-gray-600">
		{data.claimed} of {data.total} accounts set up. This code changes automatically — leave this page
		open.
	</p>
	<a href={resolve('/admin/generate-checkin-qr')} class="text-blue-600 underline">
		Show the check-in code
	</a>
</QrScreen>
