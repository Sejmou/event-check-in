<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head><title>Event check-in</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
	<h1 class="text-2xl font-semibold">Event check-in</h1>
	<p class="text-gray-600">
		Open the personal link from your invitation, or scan the code at the door if you've set up a
		passkey.
	</p>
	<a href={resolve('/login')} class="text-sm text-gray-500 underline">Organizer sign-in</a>
</main>
