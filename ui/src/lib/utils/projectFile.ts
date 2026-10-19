/**
 * Save, Save As and Open for the project file.
 *
 * Where the browser has the File System Access API (Chromium), the opened or
 * saved file is remembered and Save writes back to it. Elsewhere Save
 * downloads a copy and Save As asks for the download's name first.
 *
 * File dialogs and permission prompts only appear in response to a click or
 * key press, so each one is shown before the content is built (a server round
 * trip) rather than after.
 */
import { writable, type Readable } from 'svelte/store';

const GUV_TYPES: FilePickerAcceptType[] = [
  { description: 'Illuminate project', accept: { 'application/json': ['.guv'] } },
];

export interface ProjectFileDeps {
  projectName: () => string;
  /** The full .guv text, app-owned block included. */
  buildContent: () => Promise<string>;
  /** Load a project file; true once it is the open project. */
  load: (file: File) => Promise<boolean>;
  rename: (name: string) => void;
  markClean: () => void;
  /** Ask for a file name (Save As without the API); null when cancelled. */
  askFilename: (suggested: string) => Promise<string | null>;
  /** Open through the file input (without the API). */
  openInput: () => void;
  download: (filename: string, content: string) => void;
}

export interface ProjectFile {
  /** The open file's name, or null when there is none to write back to. */
  fileName: Readable<string | null>;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  open: () => Promise<void>;
  /** Stop writing back to the current file (new project, or one opened without the API). */
  forget: () => void;
}

export function supportsFileAccess(): boolean {
  return typeof window !== 'undefined'
    && typeof window.showSaveFilePicker === 'function'
    && typeof window.showOpenFilePicker === 'function';
}

export function withGuvExtension(name: string): string {
  const trimmed = name.trim();
  return /\.guv$/i.test(trimmed) ? trimmed : `${trimmed}.guv`;
}

function stem(filename: string): string {
  return filename.replace(/\.guv$/i, '');
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

async function canWrite(handle: FileSystemFileHandle): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

async function write(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export function createProjectFile(deps: ProjectFileDeps): ProjectFile {
  let handle: FileSystemFileHandle | null = null;
  const fileName = writable<string | null>(null);

  function adopt(next: FileSystemFileHandle | null) {
    handle = next;
    fileName.set(next?.name ?? null);
  }

  async function saveAs(): Promise<void> {
    if (!supportsFileAccess()) {
      const name = await deps.askFilename(deps.projectName());
      if (!name) return;
      const filename = withGuvExtension(name);
      deps.download(filename, await deps.buildContent());
      deps.rename(stem(filename));
      deps.markClean();
      return;
    }
    let target: FileSystemFileHandle;
    try {
      target = await window.showSaveFilePicker!({
        suggestedName: withGuvExtension(deps.projectName()),
        types: GUV_TYPES,
      });
    } catch (e) {
      if (isAbort(e)) return;
      throw e;
    }
    await write(target, await deps.buildContent());
    adopt(target);
    deps.rename(stem(target.name));
    deps.markClean();
  }

  async function save(): Promise<void> {
    if (!supportsFileAccess()) {
      deps.download(withGuvExtension(deps.projectName()), await deps.buildContent());
      deps.markClean();
      return;
    }
    const target = handle;
    if (!target || !(await canWrite(target).catch(() => false))) return saveAs();
    const content = await deps.buildContent();
    try {
      await write(target, content);
    } catch {
      // Moved, deleted or locked since it was opened: save it somewhere else
      return saveAs();
    }
    deps.markClean();
  }

  async function open(): Promise<void> {
    if (!supportsFileAccess()) {
      deps.openInput();
      return;
    }
    let picked: FileSystemFileHandle[];
    try {
      picked = await window.showOpenFilePicker!({ types: GUV_TYPES });
    } catch (e) {
      if (isAbort(e)) return;
      throw e;
    }
    const [target] = picked;
    if (await deps.load(await target.getFile())) adopt(target);
  }

  return { fileName, save, saveAs, open, forget: () => adopt(null) };
}
