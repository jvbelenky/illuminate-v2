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
    analyzeLampIes: vi.fn(),
    plotLampIes: vi.fn().mockResolvedValue({ photometric_plot_base64: 'UExPVA==' }),
    parseSpectrumFile: vi.fn().mockResolvedValue({
      wavelengths: [218, 220, 222, 224, 226],
      series: [{ index: 0, label: 'I', intensities: [0.1, 0.5, 1, 0.4, 0.1], peak_wavelength: 222, acgih_skin: null, acgih_eye: null }],
      num_series: 1,
    }),
  };
});
import { getLampContentHash, analyzeLampIes } from '$lib/api/client';

// The fixture editor needs WebGL; a stub exposes the draft and edits it.
vi.mock('./FixtureEditor.svelte', async () => ({
  default: (await import('./test/FixtureEditorStub.svelte')).default,
}));
// The preview column's 3D scene needs WebGL.
vi.mock('@threlte/core', async () => {
  const Stub = (await import('./test/Stub.svelte')).default;
  return { Canvas: Stub, T: {}, useThrelte: () => ({ scene: {} }), useTask: () => {} };
});
vi.mock('./FixtureScene.svelte', async () => ({
  default: (await import('./test/Stub.svelte')).default,
}));

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

    expect(screen.getByText('Saved in storage')).toBeInTheDocument();
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

    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'browser', contentHash: 'hash-abc', name: 'My Lamp' })
    );
    expect(getLampContentHash).toHaveBeenCalled();
  });

  it('add mode: unchecking "save to storage" saves scope:project', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn() } });

    await fireEvent.click(screen.getByText('Add custom lamp'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'My Lamp' } });

    const iesFile = new File(['ies content'], 'my-lamp.ies');
    await fireEvent.change(screen.getByLabelText('IES File'), { target: { files: [iesFile] } });

    await fireEvent.click(screen.getByLabelText(/^Save to storage for future sessions\./));
    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ scope: 'project' }));
  });

  it('calls onCreated with the new def id after a successful add', async () => {
    mockAdd.mockResolvedValue('new-def-id');
    const onCreated = vi.fn();
    render(LampManagerModal, { props: { onClose: vi.fn(), onCreated } });

    await fireEvent.click(screen.getByText('Add custom lamp'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'My Lamp' } });

    const iesFile = new File(['ies content'], 'my-lamp.ies');
    await fireEvent.change(screen.getByLabelText('IES File'), { target: { files: [iesFile] } });

    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-def-id'));
  });

  it('calls onCreated for a def saved directly from the launch-prefilled form (initialLampType)', async () => {
    mockAdd.mockResolvedValue('new-def-id');
    const onCreated = vi.fn();
    render(LampManagerModal, {
      props: { onClose: vi.fn(), onCreated, initialLampType: 'krcl_222' },
    });

    // Opens directly into the form — no need to click "Add custom lamp".
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'My Lamp' } });

    const iesFile = new File(['ies content'], 'my-lamp.ies');
    await fireEvent.change(screen.getByLabelText('IES File'), { target: { files: [iesFile] } });

    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-def-id'));
  });

  it('closes the manager after saving from the launch-prefilled form (dropdown flow)', async () => {
    mockAdd.mockResolvedValue('new-def-id');
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(LampManagerModal, {
      props: { onClose, onCreated, initialLampType: 'krcl_222' },
    });

    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'My Lamp' } });
    const iesFile = new File(['ies content'], 'my-lamp.ies');
    await fireEvent.change(screen.getByLabelText('IES File'), { target: { files: [iesFile] } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-def-id'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close the manager after a standalone add from the list', async () => {
    mockAdd.mockResolvedValue('new-def-id');
    const onClose = vi.fn();
    render(LampManagerModal, { props: { onClose } });

    await fireEvent.click(screen.getByText('Add custom lamp'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'My Lamp' } });
    const iesFile = new File(['ies content'], 'my-lamp.ies');
    await fireEvent.change(screen.getByLabelText('IES File'), { target: { files: [iesFile] } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does NOT call onCreated for an unrelated def added from the list after cancelling the launch-prefilled form', async () => {
    mockAdd.mockResolvedValue('new-def-id');
    const onCreated = vi.fn();
    render(LampManagerModal, {
      props: { onClose: vi.fn(), onCreated, initialLampType: 'krcl_222' },
    });

    // Cancel back to the list without saving the prefilled (launch) form.
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Add a totally unrelated def from the list's own "Add custom lamp" button.
    await fireEvent.click(screen.getByText('Add custom lamp'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Unrelated Lamp' } });

    const iesFile = new File(['ies content'], 'unrelated.ies');
    await fireEvent.change(screen.getByLabelText('IES File'), { target: { files: [iesFile] } });

    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('does NOT call onCreated when editing an existing def', async () => {
    const existing = makeDef({ id: 'e1', name: 'Existing Lamp', scope: 'project' });
    customLampsStore.set([existing]);
    mockGet.mockReturnValue(existing);
    mockToIesFile.mockReturnValue(new File(['x'], existing.ies.filename));
    const onCreated = vi.fn();

    render(LampManagerModal, { props: { onClose: vi.fn(), onCreated } });

    await fireEvent.click(screen.getByText('Edit'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Renamed Lamp' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('initialEditDefId opens straight into editing that def and closes after Save', async () => {
    const existing = makeDef({ id: 'e1', name: 'Existing Lamp', scope: 'project', lampType: 'other', wavelength: 265 });
    customLampsStore.set([existing]);
    mockGet.mockReturnValue(existing);
    mockToIesFile.mockReturnValue(new File(['x'], existing.ies.filename));
    const onClose = vi.fn();

    render(LampManagerModal, { props: { onClose, initialEditDefId: 'e1' } });

    // Form view for that definition, no list click needed
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Existing Lamp');
    expect((screen.getByLabelText(/Wavelength/) as HTMLInputElement).value).toBe('265');

    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockAdd).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('initialEditDefId for a missing def falls back to the list', async () => {
    customLampsStore.set([]);
    mockGet.mockReturnValue(undefined);

    render(LampManagerModal, { props: { onClose: vi.fn(), initialEditDefId: 'gone' } });

    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('editing an existing def calls lampLibrary.update, never add (duplicate-on-replace regression)', async () => {
    const existing = makeDef({ id: 'e1', name: 'Existing Lamp', scope: 'project' });
    customLampsStore.set([existing]);
    mockGet.mockReturnValue(existing);
    mockToIesFile.mockReturnValue(new File(['x'], existing.ies.filename));

    render(LampManagerModal, { props: { onClose: vi.fn() } });

    await fireEvent.click(screen.getByText('Edit'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Renamed Lamp' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

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

    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

    expect(await screen.findByText(/spectrum file or a wavelength/i)).toBeInTheDocument();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('a failed Save reports beside the Save button and focuses the missing field', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn() } });

    await fireEvent.click(screen.getByText('Add custom lamp'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Other Lamp' } });
    await fireEvent.change(screen.getByLabelText('Lamp Type'), { target: { value: 'other' } });
    await fireEvent.change(screen.getByLabelText('IES File'), { target: { files: [new File(['x'], 'o.ies')] } });
    const save = screen.getByRole('button', { name: 'Save lamp' });
    await fireEvent.click(save);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/spectrum file or a wavelength/i);
    // The message sits right above the buttons, where the user is when Save fails
    expect(alert.nextElementSibling?.contains(save)).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Wavelength/)));
  });

  it('clearing an existing spectrum on an "other" lamp re-requires a wavelength before saving', async () => {
    const existing = makeDef({
      id: 'spec-1',
      name: 'Spectrum Lamp',
      scope: 'browser',
      lampType: 'other',
      wavelength: undefined,
      spectrum: { filename: 'spec.csv', dataBase64: 'AAAA' },
    });
    customLampsStore.set([existing]);
    mockGet.mockReturnValue(existing);
    mockToIesFile.mockReturnValue(new File(['x'], existing.ies.filename));

    render(LampManagerModal, { props: { onClose: vi.fn() } });

    await fireEvent.click(screen.getByText('Edit'));

    // The attached spectrum owns the wavelength: its peak is shown, not a field.
    expect(screen.queryByLabelText(/Wavelength/)).toBeNull();

    // Removing it (on the Spectrum page) brings the wavelength field back.
    await fireEvent.click(document.querySelector('[data-facet-open="spectrum"]')!);
    await fireEvent.click(screen.getByTitle('Remove spectrum file'));
    expect(screen.getByLabelText(/Wavelength/)).not.toBeDisabled();
    expect(screen.queryByText('spec.csv')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));

    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

    expect(await screen.findByText(/spectrum file or a wavelength/i)).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('clearing an existing spectrum removes it from the save patch and recomputes the hash without it', async () => {
    const existing = makeDef({
      id: 'spec-2',
      name: 'Spectrum Lamp',
      scope: 'browser',
      lampType: 'other',
      wavelength: undefined,
      spectrum: { filename: 'spec.csv', dataBase64: 'AAAA' },
    });
    customLampsStore.set([existing]);
    mockGet.mockReturnValue(existing);
    mockToIesFile.mockReturnValue(new File(['x'], existing.ies.filename));

    render(LampManagerModal, { props: { onClose: vi.fn() } });

    await fireEvent.click(screen.getByText('Edit'));
    await fireEvent.click(document.querySelector('[data-facet-open="spectrum"]')!);
    await fireEvent.click(screen.getByTitle('Remove spectrum file'));
    await fireEvent.input(screen.getByLabelText(/Wavelength/), { target: { value: '275' } });
    await fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    // opening the form reads the saved spectrum for its preview; saving must not
    mockToSpectrumFile.mockClear();
    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith(
      'spec-2',
      expect.objectContaining({ spectrum: undefined, wavelength: 275 })
    );

    // The hash must be recomputed without the (now-cleared) spectrum file.
    expect(getLampContentHash).toHaveBeenCalledTimes(1);
    const [, spectrumArg] = vi.mocked(getLampContentHash).mock.calls[0];
    expect(spectrumArg).toBeUndefined();
    expect(mockToSpectrumFile).not.toHaveBeenCalled();
  });

  it('has no Advanced section; editing keeps a definition\'s intensity map and source density', async () => {
    const existing = makeDef({
      id: 'imap-1',
      name: 'Imap Lamp',
      scope: 'browser',
      lampType: 'krcl_222',
      sourceDensity: 3,
      intensityMap: { filename: 'map.csv', dataBase64: 'AAAA' },
    });
    customLampsStore.set([existing]);
    mockGet.mockReturnValue(existing);
    mockToIesFile.mockReturnValue(new File(['x'], existing.ies.filename));

    render(LampManagerModal, { props: { onClose: vi.fn() } });
    await fireEvent.click(screen.getByText('Edit'));

    // source density and the intensity map live in Advanced Lamp Settings now
    expect(screen.queryByText('Advanced')).toBeNull();
    expect(document.querySelector('#source-density')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith(
      'imap-1',
      expect.objectContaining({ sourceDensity: 3, intensityMap: { filename: 'map.csv', dataBase64: 'AAAA' } })
    );
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

  // --- Name auto-population from the IES filename (add mode) ------------------

  it('add mode: picking an IES file auto-populates the name with the filename', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn() } });
    await fireEvent.click(screen.getByText('Add custom lamp'));

    const iesFile = new File(['ies content'], 'lamp1.ies');
    await fireEvent.change(screen.getByLabelText('IES File'), { target: { files: [iesFile] } });

    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('lamp1.ies')
    );
  });

  it('add mode: a second IES pick overwrites the auto-populated name when untouched', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn() } });
    await fireEvent.click(screen.getByText('Add custom lamp'));

    await fireEvent.change(screen.getByLabelText('IES File'), {
      target: { files: [new File(['a'], 'lamp1.ies')] },
    });
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('lamp1.ies')
    );

    await fireEvent.change(screen.getByLabelText('IES File'), {
      target: { files: [new File(['b'], 'lamp2.ies')] },
    });
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('lamp2.ies')
    );
  });

  it('add mode: does NOT overwrite the name after the user has typed one', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn() } });
    await fireEvent.click(screen.getByText('Add custom lamp'));

    await fireEvent.change(screen.getByLabelText('IES File'), {
      target: { files: [new File(['a'], 'lamp1.ies')] },
    });
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('lamp1.ies')
    );

    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'My Custom Name' } });
    await fireEvent.change(screen.getByLabelText('IES File'), {
      target: { files: [new File(['b'], 'lamp2.ies')] },
    });

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('My Custom Name');
  });

  it('add mode: clearing the name re-enables auto-population on the next IES pick', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn() } });
    await fireEvent.click(screen.getByText('Add custom lamp'));

    await fireEvent.change(screen.getByLabelText('IES File'), {
      target: { files: [new File(['a'], 'lamp1.ies')] },
    });
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('lamp1.ies')
    );

    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Typed Name' } });
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: '' } });

    await fireEvent.change(screen.getByLabelText('IES File'), {
      target: { files: [new File(['b'], 'lamp2.ies')] },
    });
    await waitFor(() =>
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('lamp2.ies')
    );
  });

  it('edit mode: replacing the IES file never renames the existing definition', async () => {
    const existing = makeDef({
      id: 'e1',
      name: 'Existing Lamp',
      scope: 'project',
      ies: { filename: 'orig.ies', dataBase64: 'AAAA' },
    });
    customLampsStore.set([existing]);
    mockGet.mockReturnValue(existing);
    mockToIesFile.mockReturnValue(new File(['x'], existing.ies.filename));

    render(LampManagerModal, { props: { onClose: vi.fn() } });

    await fireEvent.click(screen.getByText('Edit'));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Existing Lamp');

    await fireEvent.change(screen.getByLabelText('IES File'), {
      target: { files: [new File(['new'], 'replacement.ies')] },
    });

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Existing Lamp');
  });
});

describe('LampManagerModal orientation & mounting', () => {
  const analysis = {
    suggested_axis: 'horizontal_0',
    file_figures: [
      { units: 'mw/sr', total_power_mw: 42.5, max_irradiance: 7, center_irradiance: 5 },
      { units: 'uw/cm2', total_power_mw: 425, max_irradiance: 70, center_irradiance: 50 },
    ],
    axis_scores: {},
    ies_dimensions: { width: 1, length: 1, height: 0 },
    vertices: [],
    triangles: [],
    extents_by_axis: {},
  };

  beforeEach(() => {
    vi.mocked(analyzeLampIes).mockReset().mockResolvedValue(analysis as any);
    vi.mocked(getLampContentHash).mockReset().mockResolvedValue({ content_hash: 'h' });
    mockAdd.mockReset().mockResolvedValue('new-id');
    mockGet.mockReset();
    mockToIesFile.mockReset();
    mockFileToEmbedded.mockReset().mockResolvedValue({ filename: 'wall.ies', dataBase64: 'AAAA' });
    customLampsStore.set([]);
  });

  async function chooseIes() {
    const input = document.querySelector('#ies-file-input') as HTMLInputElement;
    const file = new File(['TILT=NONE'], 'wall.ies');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await fireEvent.change(input);
    return file;
  }

  /** Open the Fixture card's detail view (the fixture editor). */
  async function openEditor() {
    await waitFor(() => expect(document.querySelector('[data-facet-open="fixture"]')).not.toBeNull());
    await fireEvent.click(document.querySelector('[data-facet-open="fixture"]')!);
    await waitFor(() => expect(screen.getByTestId('fixture-stub')).toBeTruthy());
  }

  const card = (facet: string) => document.querySelector(`.facet-card[data-facet="${facet}"]`) as HTMLElement;
  const openPage = async (facet: string) => {
    await waitFor(() => expect(document.querySelector(`[data-facet-open="${facet}"]`)).not.toHaveProperty('disabled', true));
    await fireEvent.click(document.querySelector(`[data-facet-open="${facet}"]`)!);
  };
  const back = () => fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));

  it('scaling offers the advanced-settings methods and defaults to total power from the file', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    // scaling is set on the Photometry page, not on the card
    expect(card('photometry').querySelector('#scaling-method')).toBeNull();
    await openPage('photometry');
    const method = document.querySelector('#scaling-method') as HTMLSelectElement;
    expect([...method.options].map((o) => o.value)).toEqual(['total', 'max', 'center', 'factor']);
    expect(method.value).toBe('total');
    await waitFor(() => expect((document.querySelector('#scaling-value') as HTMLInputElement).placeholder).toBe('42.5'));
    expect(document.querySelector('.scaling-unit')!.textContent).toBe('mW');
  });

  it('a typed scaling target is saved with its method; an untouched one is not', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await openPage('photometry');
    await fireEvent.input(document.querySelector('#scaling-value')!, { target: { value: '50' } });
    await back();
    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(mockAdd.mock.calls[0][0]).toEqual(expect.objectContaining({ scalingMethod: 'total', scalingValue: 50 }));
  });

  it('the file\'s figures follow the intensity units', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await openPage('photometry');
    const units = screen.getByLabelText('Intensity units') as HTMLSelectElement;
    const value = () => document.querySelector('.unit-value b')!.textContent;
    await waitFor(() => expect(value()).toBe('42.5'));
    await fireEvent.change(units, { target: { value: 'uw/cm2' } });
    expect(value()).toBe('425');
    expect((document.querySelector('#scaling-value') as HTMLInputElement).placeholder).toBe('425');
    await fireEvent.change(document.querySelector('#scaling-method')!, { target: { value: 'max' } });
    expect((document.querySelector('#scaling-value') as HTMLInputElement).placeholder).toBe('70');
    await back();
    expect(card('photometry').textContent).toMatch(/Total power\s*425 mW/);
  });

  it('a legacy scaling factor opens as "Scale by factor"', async () => {
    const def = makeDef({ id: 'd2', scalingFactor: 2 });
    customLampsStore.set([def]);
    mockGet.mockReturnValue(def);
    mockToIesFile.mockReturnValue(new File(['TILT=NONE'], 'x.ies'));
    render(LampManagerModal, { props: { onClose: vi.fn(), initialEditDefId: 'd2' } });
    await openPage('photometry');
    await waitFor(() => expect((document.querySelector('#scaling-method') as HTMLSelectElement).value).toBe('factor'));
    expect((document.querySelector('#scaling-value') as HTMLInputElement).value).toBe('2');
  });

  it('shows the lamp as three cards: photometry, spectrum and fixture', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    expect(['photometry', 'spectrum', 'fixture'].map((f) => !!card(f))).toEqual([true, true, true]);
    // nothing to preview before an IES file is chosen
    expect(card('photometry').textContent).toMatch(/Choose an IES file/);
    expect(card('fixture').textContent).toMatch(/after an IES file is chosen/);
  });

  it('the photometry card previews the distribution and total power', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await waitFor(() => expect(card('photometry').querySelector('img.photometric-plot')!.getAttribute('src')).toBe('data:image/png;base64,UExPVA=='));
    expect(card('photometry').textContent).toMatch(/Total power\s*42\.5 mW/);
  });

  it('a total-power scaling target shows next to the file\'s total', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await waitFor(() => expect(card('photometry').textContent).toMatch(/42\.5 mW/));
    await openPage('photometry');
    await fireEvent.input(document.querySelector('#scaling-value')!, { target: { value: '50' } });
    await back();
    await waitFor(() => expect(card('photometry').textContent).toMatch(/50 mW \(scaled from 42\.5 mW\)/));
  });

  it('without a spectrum file the spectrum card shows the lamp type\'s line', () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    expect(card('spectrum').textContent).toMatch(/254 nm \(assumed\)/);
  });

  it('a spectrum file shows its curve and peak on the spectrum card', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'krcl_222' } });
    const input = card('spectrum').querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['wl,I'], 'krcl.csv')], configurable: true });
    await fireEvent.change(input);
    await waitFor(() => expect(card('spectrum').textContent).toMatch(/Peak\s*222 nm/));
  });

  it('a freshly uploaded fixture is Auto-detected; looking without changing keeps it so', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await waitFor(() => expect(card('fixture').textContent).toMatch(/Auto-detected/));
    expect(card('fixture').textContent).toMatch(/Mounted on the wall/);
    expect(card('fixture').textContent).toMatch(/Luminous opening/);
    expect(card('fixture').textContent).toMatch(/Luminaire housing/);
    expect(screen.queryByRole('button', { name: 'Looks right' })).toBeNull();
    await openEditor();
    await fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(card('fixture').textContent).toMatch(/Auto-detected/);
  });

  it('changing a fixture setting marks it Edited, and saves that', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await openEditor();
    await fireEvent.click(screen.getByTestId('roll-90'));
    await fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(card('fixture').textContent).toMatch(/Edited/);
    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(mockAdd.mock.calls[0][0]).toEqual(expect.objectContaining({ fixtureEdited: true }));
  });

  it('every card opens its page with Edit', () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    expect(['photometry', 'spectrum', 'fixture'].map((f) => card(f).querySelector('[data-facet-open]')!.textContent)).toEqual(['Edit', 'Edit', 'Edit']);
  });

  it('a card\'s page has only Back: no cards, name, Cancel or Save; Back returns', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await fireEvent.click(document.querySelector('[data-facet-open="photometry"]')!);
    expect(card('photometry')).toBeNull();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save lamp' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByLabelText(/Save to storage/)).toBeNull();
    expect(screen.getByRole('heading', { name: /› Photometry/ })).toBeTruthy();
    expect(document.querySelector('.facet-detail img.photometric-plot')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(card('photometry')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save lamp' })).toBeTruthy();
  });

  it('Escape on a card\'s page goes back instead of closing', async () => {
    const onClose = vi.fn();
    render(LampManagerModal, { props: { onClose, initialLampType: 'lp_254' } });
    await fireEvent.click(document.querySelector('[data-facet-open="spectrum"]')!);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(card('spectrum')).not.toBeNull();
  });

  it('the spectrum page can change the lamp type', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await fireEvent.click(document.querySelector('[data-facet-open="spectrum"]')!);
    await fireEvent.change(screen.getByLabelText('Lamp Type'), { target: { value: 'other' } });
    expect(screen.getByLabelText(/Wavelength/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect((screen.getByLabelText('Lamp Type') as HTMLSelectElement).value).toBe('other');
    expect(card('spectrum').textContent).toMatch(/Needs a wavelength/);
  });

  it('analyzes a chosen IES file and pre-selects the suggested axis', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    const file = await chooseIes();
    await openEditor();
    await waitFor(() => expect(analyzeLampIes).toHaveBeenCalledWith(file));
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('horizontal_0'));
  });

  it('saves the chosen axis on the definition', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await openEditor();
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('horizontal_0'));
    await fireEvent.click(screen.getByTestId('pick-up'));
    await fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    const fields = mockAdd.mock.calls[0][0];
    expect(fields.photometricAxis).toBe('up');
  });

  it('a wall sheet mounts by the back of the file frame', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await openEditor();
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('horizontal_0'));
    expect(screen.getByTestId('face').textContent).toBe('back');
  });

  it('follows the axis with the file frame until the user picks a face', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await openEditor();
    await waitFor(() => expect(screen.getByTestId('face').textContent).toBe('back'));
    await fireEvent.click(screen.getByTestId('pick-up'));
    expect(screen.getByTestId('face').textContent).toBe('bottom');
    expect(screen.getByTestId('roll').textContent).toBe('180');
    await fireEvent.click(screen.getByTestId('face-left'));
    await fireEvent.click(screen.getByTestId('pick-up'));
    expect(screen.getByTestId('face').textContent).toBe('left');
  });

  it('an edited emitter offset also stops the layout following the axis', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await openEditor();
    await waitFor(() => expect(screen.getByTestId('face').textContent).toBe('back'));
    await fireEvent.click(screen.getByTestId('protrude'));
    await fireEvent.click(screen.getByTestId('pick-up'));
    expect(screen.getByTestId('face').textContent).toBe('back');
    expect(screen.getByTestId('offset').textContent).toBe('0,0,-0.01');
  });

  it('saves face, roll and offset on the definition', async () => {
    render(LampManagerModal, { props: { onClose: vi.fn(), initialLampType: 'lp_254' } });
    await chooseIes();
    await openEditor();
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('horizontal_0'));
    await fireEvent.click(screen.getByTestId('face-top'));
    await fireEvent.click(screen.getByTestId('roll-90'));
    await fireEvent.click(screen.getByTestId('protrude'));
    await fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save lamp' }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(mockAdd.mock.calls[0][0].housing).toEqual(
      expect.objectContaining({ mountFace: 'top', roll: 90, offset: [0, 0, -0.01] })
    );
  });

  it('editing a definition shows its stored layout without re-suggesting', async () => {
    const def = makeDef({ id: 'd1', photometricAxis: 'horizontal_90', housing: { height: 0.3, mountFace: 'back', roll: 270, offset: [0, 0, 0.15] } });
    customLampsStore.set([def]);
    mockGet.mockReturnValue(def);
    mockToIesFile.mockReturnValue(new File(['TILT=NONE'], 'x.ies'));
    render(LampManagerModal, { props: { onClose: vi.fn(), initialEditDefId: 'd1' } });
    await waitFor(() => expect(analyzeLampIes).toHaveBeenCalled());
    // a stored layout counts as edited
    await waitFor(() => expect(card('fixture').textContent).toMatch(/Edited/));
    await fireEvent.click(document.querySelector('[data-facet-open="fixture"]')!);
    await waitFor(() => expect(screen.getByTestId('axis').textContent).toBe('horizontal_90'));
    expect(screen.getByTestId('face').textContent).toBe('back');
    expect(screen.getByTestId('roll').textContent).toBe('270');
    expect(screen.getByTestId('offset').textContent).toBe('0,0,0.15');
  });
});
