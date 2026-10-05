/**
 * Report meta (title, client, preparer, notes) lives in the project store.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/stores/lampLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/stores/lampLibrary')>();
  const lampLibrary = {
    get: vi.fn(), toIesFile: vi.fn(), toSpectrumFile: vi.fn(), toIntensityMapFile: vi.fn(),
    findByHash: vi.fn(), add: vi.fn(), ready: vi.fn(() => Promise.resolve()),
  };
  return { ...actual, lampLibrary };
});

import { project, reportMeta } from '$lib/stores/project';

describe('report meta', () => {
  beforeEach(() => project.reset({ skipBackendSync: true }));

  it('defaults the title to the project name and the rest to empty', () => {
    const m = get(reportMeta);
    expect(m.title).toBe(get(project).name);
    expect(m).toMatchObject({ client: '', prepared_by: '', notes: '' });
  });

  it('updateReportMeta merges and persists in the project', () => {
    project.updateReportMeta({ client: 'Acme' });
    project.updateReportMeta({ title: 'Lab 3' });
    expect(get(reportMeta)).toEqual({ title: 'Lab 3', client: 'Acme', prepared_by: '', notes: '' });
    expect(get(project).reportMeta).toMatchObject({ title: 'Lab 3', client: 'Acme' });
  });

  it('follows a renamed project until a title is typed', () => {
    project.setName('north_wing');
    expect(get(reportMeta).title).toBe('north_wing');
    project.updateReportMeta({ title: 'Custom' });
    project.setName('other');
    expect(get(reportMeta).title).toBe('Custom');
  });

  it('reset clears it', () => {
    project.updateReportMeta({ client: 'Acme' });
    project.reset({ skipBackendSync: true });
    expect(get(reportMeta).client).toBe('');
  });
});
