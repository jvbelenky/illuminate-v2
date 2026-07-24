import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import LampManagerModal from './LampManagerModal.svelte';
import type { CustomLampDef } from '$lib/types/lampLibrary';
import type { LampInstance } from '$lib/types/project';

// --- $lib/api/client -------------------------------------------------------
vi.mock('$lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/api/client')>();
  return {
    ...actual,
    getLampContentHash: vi.fn(),
  };
});
import { getLampContentHash } from '$lib/api/client';

// Note: each vi.mock() factory below builds its own minimal hand-rolled store
// inline (rather than importing 'svelte/store') because vi.hoisted() factories
// run before this module's own imports are initialized.

// --- $lib/stores/lampLibrary -------------------------------------------------
const {
  customLampsStore,
  mockAdd,
  mockUpdate,
  mockRemove,
  mockSetScope,
  mockGet,
  mockToIesFile,
  mockToSpectrumFile,
  mockToIntensityMapFile,
  mockFileToEmbedded,
} = vi.hoisted(() => {
  function createStore<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(fn: (v: T) => void) {
        fn(value);
        subs.add(fn);
        return () => subs.delete(fn);
      },
      set(v: T) {
        value = v;
        subs.forEach((fn) => fn(value));
      },
    };
  }
  return {
    customLampsStore: createStore<CustomLampDef[]>([]),
    mockAdd: vi.fn(),
    mockUpdate: vi.fn(),
    mockRemove: vi.fn(),
    mockSetScope: vi.fn(),
    mockGet: vi.fn(),
    mockToIesFile: vi.fn(),
    mockToSpectrumFile: vi.fn(),
    mockToIntensityMapFile: vi.fn(),
    mockFileToEmbedded: vi.fn(),
  };
});

vi.mock('$lib/stores/lampLibrary', () => ({
  customLamps: customLampsStore,
  fileToEmbedded: (...args: unknown[]) => mockFileToEmbedded(...args),
  lampLibrary: {
    add: (...args: unknown[]) => mockAdd(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    setScope: (...args: unknown[]) => mockSetScope(...args),
    get: (...args: unknown[]) => mockGet(...args),
    toIesFile: (...args: unknown[]) => mockToIesFile(...args),
    toSpectrumFile: (...args: unknown[]) => mockToSpectrumFile(...args),
    toIntensityMapFile: (...args: unknown[]) => mockToIntensityMapFile(...args),
    isInitialized: () => true,
    findByHash: vi.fn(),
    init: vi.fn(),
  },
}));

// --- $lib/stores/project -----------------------------------------------------
const { lampsStore, mockPropagateCustomLampEdit, mockDetachCustomLamp } = vi.hoisted(() => {
  function createStore<T>(initial: T) {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(fn: (v: T) => void) {
        fn(value);
        subs.add(fn);
        return () => subs.delete(fn);
      },
      set(v: T) {
        value = v;
        subs.forEach((fn) => fn(value));
      },
    };
  }
  return {
    lampsStore: createStore<LampInstance[]>([]),
    mockPropagateCustomLampEdit: vi.fn().mockResolvedValue(undefined),
    mockDetachCustomLamp: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('$lib/stores/project', () => ({
  lamps: lampsStore,
  project: {
    propagateCustomLampEdit: (...args: unknown[]) => mockPropagateCustomLampEdit(...args),
    detachCustomLamp: (...args: unknown[]) => mockDetachCustomLamp(...args),
  },
}));

function makeDef(overrides: Partial<CustomLampDef> = {}): CustomLampDef {
  return {
    id: 'def-1',
    name: 'Test Lamp',
    lampType: 'krcl_222',
    ies: { filename: 'test.ies', dataBase64: 'AAAA' },
    scope: 'browser',
    contentHash: 'hash-0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLampInstance(overrides: Partial<LampInstance> = {}): LampInstance {
  return {
    id: 'lamp-1',
    lamp_type: 'krcl_222',
    name: 'Placed Lamp',
    x: 1,
    y: 1,
    z: 2,
    aimx: 1,
    aimy: 1,
    aimz: 0,
    scaling_factor: 1,
    enabled: true,
    ...overrides,
  };
}

describe('LampManagerModal', () => {
  beforeEach(() => {
    customLampsStore.set([]);
    lampsStore.set([]);
    mockAdd.mockReset();
    mockUpdate.mockReset();
    mockRemove.mockReset();
    mockSetScope.mockReset();
    mockGet.mockReset();
    mockToIesFile.mockReset();
    mockToSpectrumFile.mockReset();
    mockToIntensityMapFile.mockReset();
    mockFileToEmbedded.mockReset().mockResolvedValue({ filename: 'test.ies', dataBase64: 'AAAA' });
    mockPropagateCustomLampEdit.mockReset().mockResolvedValue(undefined);
    mockDetachCustomLamp.mockReset().mockResolvedValue(undefined);
    vi.mocked(getLampContentHash).mockReset().mockResolvedValue({ content_hash: 'hash-abc' });
  });

  it('renders the list view with two sections for mixed-scope defs', () => {
    customLampsStore.set([
      makeDef({ id: 'b1', name: 'Browser Lamp', scope: 'browser', lampType: 'krcl_222' }),
      makeDef({ id: 'p1', name: 'Project Lamp', scope: 'project', lampType: 'lp_254' }),
    ]);

    render(LampManagerModal, { props: { onClose: vi.fn() } });

    expect(screen.getByText('Saved in browser')).toBeInTheDocument();
    expect(screen.getByText('This project only')).toBeInTheDocument();
    expect(screen.getByText('Browser Lamp')).toBeInTheDocument();
    expect(screen.getByText('Project Lamp')).toBeInTheDocument();
    expect(screen.getByText('222 nm')).toBeInTheDocument();
    expect(screen.getByText('254 nm')).toBeInTheDocument();
  });

  it('add mode: save defaults to browser scope and uses the hash from getLampContentHash', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn() } });

    await fireEvent.click(screen.getByText('Add custom lamp'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'My Lamp' } });

    const iesFile = new File(['ies content'], 'my-lamp.ies');
    await fireEvent.change(screen.getByLabelText('IES File'), { target: { files: [iesFile] } });

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'browser', contentHash: 'hash-abc', name: 'My Lamp' })
    );
    expect(getLampContentHash).toHaveBeenCalled();
  });

  it('add mode: unchecking "save to browser" saves scope:project', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn() } });

    await fireEvent.click(screen.getByText('Add custom lamp'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'My Lamp' } });

    const iesFile = new File(['ies content'], 'my-lamp.ies');
    await fireEvent.change(screen.getByLabelText('IES File'), { target: { files: [iesFile] } });

    await fireEvent.click(screen.getByLabelText('Save to browser for future sessions'));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ scope: 'project' }));
  });

  it('editing an existing def calls lampLibrary.update, never add (duplicate-on-replace regression)', async () => {
    const existing = makeDef({ id: 'e1', name: 'Existing Lamp', scope: 'project' });
    customLampsStore.set([existing]);
    mockGet.mockReturnValue(existing);
    mockToIesFile.mockReturnValue(new File(['x'], existing.ies.filename));

    render(LampManagerModal, { props: { onClose: vi.fn() } });

    await fireEvent.click(screen.getByText('Edit'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Renamed Lamp' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith('e1', expect.objectContaining({ name: 'Renamed Lamp' }));
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockPropagateCustomLampEdit).toHaveBeenCalledWith('e1');
  });

  it('"other" lamp type without spectrum or wavelength shows a validation error and does not save', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn() } });

    await fireEvent.click(screen.getByText('Add custom lamp'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Other Lamp' } });
    await fireEvent.change(screen.getByLabelText('Lamp Type'), { target: { value: 'other' } });

    const iesFile = new File(['x'], 'o.ies');
    await fireEvent.change(screen.getByLabelText('IES File'), { target: { files: [iesFile] } });

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/spectrum file or a wavelength/i)).toBeInTheDocument();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('deleting an in-use def shows the confirm dialog listing the lamp name', async () => {
    const def = makeDef({ id: 'd1', name: 'InUse Lamp', scope: 'browser' });
    customLampsStore.set([def]);
    lampsStore.set([makeLampInstance({ id: 'lamp-1', name: 'My Placed Lamp', custom_lamp_id: 'd1' })]);

    render(LampManagerModal, { props: { onClose: vi.fn() } });

    await fireEvent.click(screen.getByText('Delete'));

    expect(await screen.findByText(/My Placed Lamp/)).toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
