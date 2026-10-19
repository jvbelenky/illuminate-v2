import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { createProjectFile, type ProjectFileDeps } from './projectFile';

function fakeHandle(name: string, opts: { permission?: PermissionState; writeError?: Error } = {}) {
  const written: string[] = [];
  const handle = {
    kind: 'file',
    name,
    queryPermission: vi.fn(async () => opts.permission ?? 'granted'),
    requestPermission: vi.fn(async () => opts.permission ?? 'granted'),
    createWritable: vi.fn(async () => {
      if (opts.writeError) throw opts.writeError;
      return {
        write: vi.fn(async (data: string) => { written.push(data); }),
        close: vi.fn(async () => {}),
      };
    }),
    getFile: vi.fn(async () => new File(['{}'], name)),
  };
  return { handle: handle as unknown as FileSystemFileHandle, written, raw: handle };
}

function abortError() {
  return new DOMException('The user aborted a request.', 'AbortError');
}

function makeDeps(overrides: Partial<ProjectFileDeps> = {}) {
  const order: string[] = [];
  const deps: ProjectFileDeps = {
    projectName: () => 'Lab 3',
    buildContent: vi.fn(async () => { order.push('build'); return 'GUV'; }),
    load: vi.fn(async () => true),
    rename: vi.fn(),
    markClean: vi.fn(),
    askFilename: vi.fn(async () => 'renamed'),
    openInput: vi.fn(),
    download: vi.fn(),
    ...overrides,
  };
  return { deps, order };
}

describe('projectFile with the File System Access API', () => {
  let saveHandles: ReturnType<typeof fakeHandle>[];
  let openHandles: ReturnType<typeof fakeHandle>[];
  let pickerCalls: string[];

  beforeEach(() => {
    saveHandles = [];
    openHandles = [];
    pickerCalls = [];
    window.showSaveFilePicker = vi.fn(async (options?: SaveFilePickerOptions) => {
      pickerCalls.push(`save:${options?.suggestedName}`);
      const next = saveHandles.shift();
      if (!next) throw abortError();
      return next.handle;
    });
    window.showOpenFilePicker = vi.fn(async () => {
      pickerCalls.push('open');
      const next = openHandles.shift();
      if (!next) throw abortError();
      return [next.handle];
    });
  });

  afterEach(() => {
    delete window.showSaveFilePicker;
    delete window.showOpenFilePicker;
  });

  it('Save As picks a file before building the content, writes it, and adopts its name', async () => {
    const target = fakeHandle('lab-3-final.guv');
    saveHandles.push(target);
    const { deps, order } = makeDeps();
    (window.showSaveFilePicker as ReturnType<typeof vi.fn>).mockImplementationOnce(async (options?: SaveFilePickerOptions) => {
      order.push('pick');
      pickerCalls.push(`save:${options?.suggestedName}`);
      return target.handle;
    });
    const file = createProjectFile(deps);

    await file.saveAs();

    expect(order).toEqual(['pick', 'build']);
    expect(pickerCalls).toEqual(['save:Lab 3.guv']);
    expect(target.written).toEqual(['GUV']);
    expect(deps.rename).toHaveBeenCalledWith('lab-3-final');
    expect(deps.markClean).toHaveBeenCalled();
    expect(get(file.fileName)).toBe('lab-3-final.guv');
  });

  it('Save with no file yet behaves like Save As; afterwards it overwrites that file', async () => {
    const target = fakeHandle('lab.guv');
    saveHandles.push(target);
    const { deps } = makeDeps();
    const file = createProjectFile(deps);

    await file.save();
    await file.save();

    expect(pickerCalls).toEqual(['save:Lab 3.guv']);
    expect(target.written).toEqual(['GUV', 'GUV']);
    expect(deps.download).not.toHaveBeenCalled();
  });

  it('Open loads the picked file and Save then writes back to it, asking for permission first', async () => {
    const opened = fakeHandle('existing.guv', { permission: 'prompt' });
    opened.raw.requestPermission.mockResolvedValue('granted');
    openHandles.push(opened);
    const { deps } = makeDeps();
    const file = createProjectFile(deps);

    await file.open();
    expect(deps.load).toHaveBeenCalledWith(expect.any(File));
    expect(get(file.fileName)).toBe('existing.guv');

    await file.save();
    expect(opened.raw.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(opened.written).toEqual(['GUV']);
    expect(pickerCalls).toEqual(['open']);
  });

  it('a failed load keeps the previous file', async () => {
    const first = fakeHandle('first.guv');
    const second = fakeHandle('second.guv');
    openHandles.push(first, second);
    const load = vi.fn(async () => true);
    const { deps } = makeDeps({ load });
    const file = createProjectFile(deps);

    await file.open();
    load.mockResolvedValueOnce(false);
    await file.open();

    expect(get(file.fileName)).toBe('first.guv');
  });

  it('falls back to Save As when permission is denied or the file is gone', async () => {
    const denied = fakeHandle('denied.guv', { permission: 'denied' });
    openHandles.push(denied);
    const replacement = fakeHandle('replacement.guv');
    saveHandles.push(replacement);
    const { deps } = makeDeps();
    const file = createProjectFile(deps);
    await file.open();

    await file.save();
    expect(denied.written).toEqual([]);
    expect(replacement.written).toEqual(['GUV']);
    expect(get(file.fileName)).toBe('replacement.guv');

    const gone = fakeHandle('gone.guv', { writeError: new DOMException('gone', 'NotFoundError') });
    openHandles.push(gone);
    const another = fakeHandle('another.guv');
    saveHandles.push(another);
    await file.open();
    await file.save();
    expect(another.written).toEqual(['GUV']);
  });

  it('cancelling a dialog does nothing', async () => {
    const { deps } = makeDeps();
    const file = createProjectFile(deps);

    await file.saveAs();
    await file.open();

    expect(deps.buildContent).not.toHaveBeenCalled();
    expect(deps.load).not.toHaveBeenCalled();
    expect(deps.markClean).not.toHaveBeenCalled();
    expect(get(file.fileName)).toBeNull();
  });

  it('forget drops the file, so the next Save asks again', async () => {
    saveHandles.push(fakeHandle('a.guv'), fakeHandle('b.guv'));
    const { deps } = makeDeps();
    const file = createProjectFile(deps);

    await file.save();
    file.forget();
    expect(get(file.fileName)).toBeNull();
    await file.save();

    expect(pickerCalls).toEqual(['save:Lab 3.guv', 'save:Lab 3.guv']);
  });

  it('a failure building the content propagates and leaves the project unsaved', async () => {
    saveHandles.push(fakeHandle('a.guv'));
    const { deps } = makeDeps({ buildContent: vi.fn(async () => { throw new Error('session gone'); }) });
    const file = createProjectFile(deps);

    await expect(file.save()).rejects.toThrow('session gone');
    expect(deps.markClean).not.toHaveBeenCalled();
  });
});

describe('projectFile without the File System Access API', () => {
  it('Save downloads the project under its name', async () => {
    const { deps } = makeDeps();
    const file = createProjectFile(deps);

    await file.save();

    expect(deps.download).toHaveBeenCalledWith('Lab 3.guv', 'GUV');
    expect(deps.askFilename).not.toHaveBeenCalled();
    expect(deps.markClean).toHaveBeenCalled();
    expect(get(file.fileName)).toBeNull();
  });

  it('Save As asks for a name, downloads under it and renames the project', async () => {
    const { deps } = makeDeps({ askFilename: vi.fn(async () => 'lab-3-final.guv') });
    const file = createProjectFile(deps);

    await file.saveAs();

    expect(deps.askFilename).toHaveBeenCalledWith('Lab 3');
    expect(deps.download).toHaveBeenCalledWith('lab-3-final.guv', 'GUV');
    expect(deps.rename).toHaveBeenCalledWith('lab-3-final');
  });

  it('Save As cancelled at the name prompt does nothing', async () => {
    const { deps } = makeDeps({ askFilename: vi.fn(async () => null) });
    const file = createProjectFile(deps);

    await file.saveAs();

    expect(deps.buildContent).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
  });

  it('Open uses the file input', async () => {
    const { deps } = makeDeps();
    const file = createProjectFile(deps);

    await file.open();

    expect(deps.openInput).toHaveBeenCalled();
  });
});
