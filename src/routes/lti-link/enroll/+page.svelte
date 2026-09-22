<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		createKeyPair,
		enrollMessage,
		exportPublicKey,
		loadDeviceKey,
		saveDeviceKey,
		sign
	} from '$lib/device-key';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let token = $state('');
	let firstName = $state('');
	let embedded = $state(false);
	let alreadySetUp = $state(false);
	let mounted = $state(false);

	let publicKey = $state('');
	let signature = $state('');
	let busy = $state(false);
	let done = $state(false);
	let problem = $state('');

	let enrollForm = $state<HTMLFormElement>();
	let pendingKey: CryptoKey | undefined;

	onMount(async () => {
		// The launch hands the token over in the fragment, which no server sees.
		// Out of the address bar straight away, so it isn't bookmarked or shared.
		token = location.hash.slice(1);
		if (token) history.replaceState(history.state, '', location.pathname + location.search);
		try {
			firstName = JSON.parse(
				atob(token.split('.')[0].replaceAll('-', '+').replaceAll('_', '/'))
			).firstName;
		} catch {
			// Only a greeting.
		}

		// Inside Moodle's frame, storage belongs to Moodle's site as much as ours:
		// a key saved here would be invisible to the tab a QR scan opens.
		embedded = window.self !== window.top;
		alreadySetUp = Boolean(await loadDeviceKey().catch(() => undefined));
		mounted = true;
	});

	async function setUp() {
		busy = true;
		problem = '';
		try {
			const pair = await createKeyPair();
			publicKey = JSON.stringify(await exportPublicKey(pair.publicKey));
			signature = await sign(pair.privateKey, enrollMessage(token));
			pendingKey = pair.privateKey;
		} catch {
			busy = false;
			// crypto.subtle only exists over HTTPS; private windows may refuse storage.
			problem =
				"This browser couldn't create a key. Make sure you're not in a private window, and try again.";
			return;
		}
		await tick();
		enrollForm?.requestSubmit();
	}

	// The key is only kept once the server has stored its public half.
	const saveOnSuccess: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'success' && typeof result.data?.keyId === 'string' && pendingKey) {
				try {
					await saveDeviceKey({ keyId: result.data.keyId, privateKey: pendingKey });
					done = true;
				} catch {
					problem =
						"This browser wouldn't save the key. Make sure you're not in a private window, and try again.";
				}
			}
			pendingKey = undefined;
			busy = false;
			await update();
		};
	};
</script>

<svelte:head><title>Set up check-in</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
	{#if data.problem}
		<h1 class="text-2xl font-semibold">We couldn't set you up</h1>
		<p class="text-gray-600">{data.problem}</p>
	{:else if !mounted}
		<p class="text-gray-600">Loading…</p>
	{:else if !token}
		<h1 class="text-2xl font-semibold">Open this from Moodle</h1>
		<p class="text-gray-600">
			Open the check-in activity in your Moodle course. It sends you here, ready to set up this
			phone.
		</p>
	{:else if done}
		<h1 class="text-2xl font-semibold">This phone is set up</h1>
		<p class="text-gray-600">
			At the event, scan the code at the door with this phone's camera and you're checked in. You
			won't need Moodle again.
		</p>
		<p class="text-sm text-gray-500">
			It only works in this browser. Clearing its website data, or setting up another phone, undoes
			it — then open the Moodle activity again.
		</p>
	{:else if embedded}
		<h1 class="text-2xl font-semibold">{firstName ? `Hi, ${firstName}!` : 'Hi!'}</h1>
		<p class="text-gray-600">
			Moodle opened this inside its own page, where your browser won't keep what check-in needs.
			Continue in a tab of its own.
		</p>
		<button
			type="button"
			onclick={() => window.open(`${resolve('/lti-link/enroll')}#${token}`, '_blank', 'noopener')}
			class="w-full rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
		>
			Continue in a new tab
		</button>
	{:else}
		<h1 class="text-2xl font-semibold">{firstName ? `Hi, ${firstName}!` : 'Hi!'}</h1>
		<p class="text-gray-600">
			Set up <strong>the phone you'll bring to the event</strong>, in the browser that opens when
			you scan a QR code (usually Safari on an iPhone, Chrome on Android). After that, scanning the
			code at the door is all it takes.
		</p>
		{#if alreadySetUp}
			<p class="text-sm text-gray-500">
				This browser is already set up. Doing it again is harmless and replaces the old key.
			</p>
		{/if}
		<button
			type="button"
			onclick={setUp}
			disabled={busy}
			class="w-full rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
		>
			{busy ? 'Setting up…' : 'Set up this phone'}
		</button>

		<form method="post" action="?/enroll" hidden bind:this={enrollForm} use:enhance={saveOnSuccess}>
			<input type="hidden" name="token" value={token} />
			<input type="hidden" name="publicKey" value={publicKey} />
			<input type="hidden" name="signature" value={signature} />
		</form>
	{/if}

	<p class="text-sm text-red-600" role="alert">
		{problem || (form && 'message' in form ? form.message : '')}
	</p>
</main>
