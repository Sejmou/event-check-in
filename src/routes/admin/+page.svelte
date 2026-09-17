<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const input =
		'rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none';
	const button = 'rounded-md border border-gray-300 px-4 py-2 transition hover:bg-gray-50';

	// Only admins the superadmin can reset: not themselves.
	const resettable = $derived(data.admins?.filter((a) => a.role === 'admin') ?? []);
	const failedEmail = (action: string) =>
		form?.action === action && 'email' in form ? form.email : '';
</script>

{#snippet outcome(action: string)}
	{#if form?.action === action && 'done' in form}
		<p class="text-sm text-green-700" role="status">{form.done}</p>
	{:else if form?.action === action && 'message' in form}
		<p class="text-sm text-red-600" role="alert">{form.message}</p>
	{/if}
{/snippet}

<svelte:head><title>Organizer</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
	<h1 class="text-2xl font-semibold">Organizer</h1>
	<a href={resolve('/admin/generate-checkin-qr')} class="text-blue-600 underline">
		Show the check-in code
	</a>
	<a href={resolve('/admin/checkins')} class="text-blue-600 underline">Check-in log</a>

	{#if data.admins}
		<section class="flex flex-col gap-4 border-t border-gray-200 pt-6">
			<h2 class="text-lg font-semibold">Organizers</h2>
			<ul class="flex flex-col gap-1 text-sm">
				{#each data.admins as admin (admin.email)}
					<li>
						{admin.firstName}
						{admin.lastName}
						<span class="text-gray-500">{admin.email}</span>
						{#if admin.role === 'superadmin'}
							<span class="text-gray-500">· superadmin</span>
						{:else if admin.mustChangePassword}
							<span class="text-gray-500">· has a temporary password</span>
						{/if}
					</li>
				{/each}
			</ul>

			<form method="post" action="?/promote" use:enhance class="flex flex-col gap-4">
				<h3 class="font-medium">Make a guest an organizer</h3>
				<label class="flex flex-col gap-1">
					Guest's email
					<input
						type="email"
						name="email"
						autocomplete="off"
						required
						value={failedEmail('promote')}
						class={input}
					/>
				</label>
				<label class="flex flex-col gap-1">
					Initial password
					<input type="text" name="password" autocomplete="off" required class={input} />
					<span class="text-sm text-gray-500">
						Pass it on to them. They have to replace it when they first sign in.
					</span>
				</label>
				<button class={button}>Make organizer</button>
				{@render outcome('promote')}
			</form>

			{#if resettable.length}
				<form method="post" action="?/resetPassword" use:enhance class="flex flex-col gap-4">
					<h3 class="font-medium">Reset an organizer's password</h3>
					<label class="flex flex-col gap-1">
						Organizer
						<select name="email" required class={input}>
							{#each resettable as admin (admin.email)}
								<option value={admin.email}>
									{admin.firstName}
									{admin.lastName} ({admin.email})
								</option>
							{/each}
						</select>
					</label>
					<label class="flex flex-col gap-1">
						Temporary password
						<input type="text" name="password" autocomplete="off" required class={input} />
						<span class="text-sm text-gray-500">
							Signs them out everywhere. They have to replace it when they next sign in.
						</span>
					</label>
					<button class={button}>Reset password</button>
					{@render outcome('reset')}
				</form>
			{/if}
		</section>
	{/if}

	<a href={resolve('/admin/change-password')} class="text-blue-600 underline">
		Change your password
	</a>
	<form method="post" action="?/signOut" use:enhance>
		<button class="text-gray-500 underline">Sign out</button>
	</form>
</main>
