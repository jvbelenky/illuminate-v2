import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';
import StartChooserModal from './StartChooserModal.svelte';
import { userSettings } from '$lib/stores/settings';

function setup() {
	const onChoose = vi.fn();
	const onClose = vi.fn();
	const view = render(StartChooserModal, { props: { onChoose, onClose } });
	return { onChoose, onClose, ...view };
}

describe('StartChooserModal landing cards', () => {
	test('offers Start designing, Open a .guv file and See an example in that order', () => {
		const { baseElement } = setup();
		const cards = [...baseElement.querySelectorAll('button.landing-card')];
		expect(cards.map((c) => c.getAttribute('data-choice'))).toEqual(['empty', 'open', 'typical']);
		expect(cards.map((c) => c.textContent?.trim())).toEqual([
			'Start designing',
			'Open a .guv file',
			'See an example'
		]);
	});

	test('has no visible modal title, only the headline', () => {
		const { baseElement } = setup();
		expect(baseElement.querySelector('.modal-title')?.textContent?.trim() ?? '').toBe('');
		expect(screen.getByText(/modeling germicidal UV/)).toBeTruthy();
	});

	test('each card reports its choice', async () => {
		const { onChoose, baseElement } = setup();
		for (const choice of ['empty', 'open', 'typical']) {
			await fireEvent.click(baseElement.querySelector(`button.landing-card[data-choice="${choice}"]`)!);
			expect(onChoose).toHaveBeenLastCalledWith(choice);
		}
		expect(onChoose).toHaveBeenCalledTimes(3);
	});

	test("Don't show this again still turns off showStartChooser", async () => {
		const { onChoose, baseElement } = setup();
		await fireEvent.click(screen.getByLabelText("Don't show this again"));
		await fireEvent.click(baseElement.querySelector('button.landing-card[data-choice="open"]')!);
		expect(get(userSettings).showStartChooser).toBe(false);
		expect(onChoose).toHaveBeenCalledWith('open');
	});
});
