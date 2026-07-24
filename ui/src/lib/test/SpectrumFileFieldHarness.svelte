<script lang="ts">
	import SpectrumFileField, { type SpectrumFileFieldValue } from '../components/SpectrumFileField.svelte';

	interface Props {
		initialValue?: SpectrumFileFieldValue | null;
		currentFilename?: string;
		recommended?: boolean;
		onerror?: (msg: string) => void;
		/** Fired with the current value every time SpectrumFileField updates it, so tests can observe writes without fighting Svelte 5 bindable-prop test plumbing. */
		onvalue?: (v: SpectrumFileFieldValue | null) => void;
	}

	let { initialValue = null, currentFilename, recommended = false, onerror, onvalue }: Props = $props();

	let value: SpectrumFileFieldValue | null = $state(initialValue);

	$effect(() => {
		onvalue?.(value);
	});
</script>

<SpectrumFileField bind:value {currentFilename} {recommended} {onerror} />
