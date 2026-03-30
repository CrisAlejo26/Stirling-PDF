/**
 * Type safety declarations to prevent file.name/UUID confusion
 */

import { FileId, PDFoxFile } from '@app/types/fileContext';

declare global {
  namespace FileIdSafety {
    // Mark functions that should never accept file.name as parameters
    type SafeFileIdFunction<T extends (...args: any[]) => any> = T extends (...args: infer P) => infer _R
      ? P extends readonly [string, ...any[]]
        ? never // Reject string parameters in first position for FileId functions
        : T
      : T;

    // Mark functions that should only accept PDFoxFile, not regular File
    type PDFoxFileOnlyFunction<T extends (...args: any[]) => any> = T extends (...args: infer P) => infer _R
      ? P extends readonly [File, ...any[]]
        ? never // Reject File parameters in first position for PDFoxFile functions
        : T
      : T;

    // Utility type to enforce PDFoxFile usage
    type RequirePDFoxFile<T> = T extends File ? PDFoxFile : T;
  }

  // Extend Window interface for debugging
  interface Window {
    __FILE_ID_DEBUG?: boolean;
  }
}

// Augment FileContext types to prevent bypassing PDFoxFile
declare module '../contexts/FileContext' {
  export interface StrictFileContextActions {
    pinFile: (file: PDFoxFile) => void; // Must be PDFoxFile
    unpinFile: (file: PDFoxFile) => void; // Must be PDFoxFile
    addFiles: (files: File[], options?: { insertAfterPageId?: string }) => Promise<PDFoxFile[]>; // Returns PDFoxFile
    consumeFiles: (inputFileIds: FileId[], outputFiles: File[]) => Promise<PDFoxFile[]>; // Returns PDFoxFile
  }

  export interface StrictFileContextSelectors {
    getFile: (id: FileId) => PDFoxFile | undefined; // Returns PDFoxFile
    getFiles: (ids?: FileId[]) => PDFoxFile[]; // Returns PDFoxFile[]
    isFilePinned: (file: PDFoxFile) => boolean; // Must be PDFoxFile
  }
}

export {};
