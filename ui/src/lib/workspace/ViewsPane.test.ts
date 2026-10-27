import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Host from './test/ViewsPaneHost.svelte';

const slotOf = (id: string) => screen.getByTestId(id).closest('.view-slot') as HTMLElement;

describe('ViewsPane', () => {
	test('stacks the 2D view above the 3D view, each rendered once', () => {
		const { container } = render(Host, {});
		expect((container.querySelector('.views-pane') as HTMLElement).dataset.layout).toBe('stack');
		expect(container.querySelectorAll('[data-testid="v2d"]').length).toBe(1);
		expect(container.querySelectorAll('[data-testid="v3d"]').length).toBe(1);
		expect(slotOf('v2d').style.top).toBe('0px');
		expect(slotOf('v2d').style.height).toContain('50%');
		expect(slotOf('v3d').style.bottom).toBe('0px');
		expect(slotOf('v3d').style.height).toContain('50%');
	});

	test('has no divider, inset or Calculate slot', () => {
		const { container } = render(Host, {});
		expect(container.querySelector('.views-divider')).toBeNull();
		expect(container.querySelector('.is-inset')).toBeNull();
		expect(container.querySelector('.calculate-slot')).toBeNull();
	});
});
