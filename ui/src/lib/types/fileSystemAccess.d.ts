// The parts of the File System Access API (Chromium only) that TypeScript's
// DOM library doesn't declare yet.

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface FilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  id?: string;
}

interface SaveFilePickerOptions extends FilePickerOptions {
  suggestedName?: string;
}

interface OpenFilePickerOptions extends FilePickerOptions {
  multiple?: boolean;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface Window {
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
}
