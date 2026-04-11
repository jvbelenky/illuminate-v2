export type FileCategory = 'ies' | 'spectrum';

export interface FileEntry {
  /** Stable UUID generated at upload time. Never changes. */
  id: string;
  /** Category: photometric (IES) or spectrum (CSV/XLS/XLSX) */
  category: FileCategory;
  /** Original filename from the user's filesystem */
  originalFilename: string;
  /** User-editable display name (defaults to filename sans extension) */
  displayName: string;
  /** File extension including dot: .ies, .csv, .xls, .xlsx */
  extension: string;
  /** File size in bytes (original, not base64-encoded) */
  sizeBytes: number;
  /** base64-encoded file content */
  dataBase64: string;
  /** ISO timestamp of when the file was added */
  addedAt: string;
  /** For multi-column spectrum files: selected column index */
  spectrumColumnIndex?: number;
}
