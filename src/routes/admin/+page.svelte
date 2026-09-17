<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
</script>

<svelte:head><title>Organizer</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
	<h1 class="text-2xl font-semibold">Organizer</h1>
	<a href={resolve('/admin/generate-checkin-qr')} class="text-blue-600 underline">
		Show the check-in code
	</a>
	<a href={resolve('/admin/checkins')} class="text-blue-600 underline">Check-in log</a>
	<form method="post" action="?/signOut" use:enhance>
		<button class="text-gray-500 underline">Sign out</button>
	</form>
</main>
