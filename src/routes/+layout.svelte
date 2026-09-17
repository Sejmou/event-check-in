<script lang="ts">
	import type { Pathname } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { locales, localizeHref } from '$lib/paraglide/runtime';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	// resolve() adds the base path back, so take it off first: resolve('/') is the
	// base plus its trailing slash.
	const path = $derived(page.url.pathname.slice(resolve('/').length - 1) as Pathname);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}

<div style="display:none">
	{#each locales as locale (locale)}
		<a href={resolve(localizeHref(path, { locale }) as Pathname)}>{locale}</a>
	{/each}
</div>
