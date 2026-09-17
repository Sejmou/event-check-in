<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const input =
		'rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none';
</script>

<svelte:head><title>Change your password</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
	{#if data.temporary}
		<h1 class="text-2xl font-semibold">Choose your own password</h1>
		<p class="text-gray-600">Your password was set by someone else. Replace it before you go on.</p>
	{:else}
		<h1 class="text-2xl font-semibold">Change your password</h1>
		<p class="text-gray-600">This signs you out on every other device.</p>
	{/if}

	<form method="post" use:enhance class="flex flex-col gap-4">
		{#if !data.temporary}
			<label class="flex flex-col gap-1">
				Current password
				<input
					type="password"
					name="currentPassword"
					autocomplete="current-password"
					required
					class={input}
				/>
			</label>
		{/if}
		<label class="flex flex-col gap-1">
			New password
			<input
				type="password"
				name="password"
				autocomplete="new-password"
				minlength={data.minPasswordLength}
				required
				class={input}
			/>
		</label>
		<label class="flex flex-col gap-1">
			Confirm new password
			<input
				type="password"
				name="confirm"
				autocomplete="new-password"
				minlength={data.minPasswordLength}
				required
				class={input}
			/>
		</label>
		<button
			class="rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
		>
			Save password
		</button>
	</form>

	{#if form && 'changed' in form}
		<p class="text-sm text-green-700" role="status">Your password is changed.</p>
	{:else}
		<p class="text-sm text-red-600" role="alert">{form?.message ?? ''}</p>
	{/if}

	{#if !data.temporary}
		<a href={resolve('/admin')} class="text-gray-500 underline">Back</a>
	{/if}
</main>
