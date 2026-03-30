/**
 * File actions - Unified file operations with single addFiles helper
 */

import {
  PDFoxFileStub,
  FileContextAction,
  FileContextState,
  createNewPDFoxFileStub,
  createFileId,
  createQuickKey,
  createPDFoxFile,
  ProcessedFileMetadata,
} from '@app/types/fileContext';
import { FileId, ToolOperation } from '@app/types/file';
import { generateThumbnailWithMetadata } from '@app/utils/thumbnailUtils';
import { FileLifecycleManager } from '@app/contexts/file/lifecycle';
import { buildQuickKeySet } from '@app/contexts/file/fileSelectors';
import { PDFoxFile } from '@app/types/fileContext';
import { fileStorage } from '@app/services/fileStorage';
import { zipFileService } from '@app/services/zipFileService';
const DEBUG = process.env.NODE_ENV === 'development';
const HYDRATION_CONCURRENCY = 2;
let activeHydrations = 0;
const hydrationQueue: Array<() => Promise<void>> = [];

const scheduleMetadataHydration = (task: () => Promise<void>): void => {
  hydrationQueue.push(task);
  // Defer start to next tick to ensure initial ADD_FILES dispatch completes
  Promise.resolve().then(drainHydrationQueue);
};

const drainHydrationQueue = (): void => {
  if (activeHydrations >= HYDRATION_CONCURRENCY) {
    return;
  }
  const nextTask = hydrationQueue.shift();
  if (!nextTask) return;

  activeHydrations++;
  nextTask()
    .catch((error) => {
      console.error('[Hydration] Task failed with error:', error);
    })
    .finally(() => {
      activeHydrations--;
      drainHydrationQueue();
    });
};

/**
 * Simple mutex to prevent race conditions in addFiles
 */
class SimpleMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async lock(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve();
      });
    });
  }

  unlock(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

// Global mutex for addFiles operations
const addFilesMutex = new SimpleMutex();

/**
 * Helper to create ProcessedFile metadata structure
 */
export function createProcessedFile(
  pageCount: number,
  thumbnail?: string,
  pageRotations?: number[],
  pageDimensions?: Array<{ width: number; height: number }>
): ProcessedFileMetadata {
  return {
    totalPages: pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      pageNumber: index + 1,
      thumbnail: index === 0 ? thumbnail : undefined, // Only first page gets thumbnail initially
      rotation: pageRotations?.[index] ?? 0,
      splitBefore: false,
      width: pageDimensions?.[index]?.width,
      height: pageDimensions?.[index]?.height
    })),
    thumbnailUrl: thumbnail,
    lastProcessed: Date.now()
  };
}

/**
 * Generate fresh ProcessedFileMetadata for a file
 * Used when tools process files to ensure metadata matches actual file content
 */
export async function generateProcessedFileMetadata(file: File): Promise<ProcessedFileMetadata | undefined> {
  // Only generate metadata for PDF files
  if (!file.type.startsWith('application/pdf')) {
    return undefined;
  }

  try {
    // Generate unrotated thumbnails for PageEditor (rotation applied via CSS)
    const unrotatedResult = await generateThumbnailWithMetadata(file, false);

    // Generate rotated thumbnail for file manager display
    const rotatedResult = await generateThumbnailWithMetadata(file, true);

    const processedFile = createProcessedFile(
      unrotatedResult.pageCount,
      unrotatedResult.thumbnail, // Page thumbnails (unrotated)
      unrotatedResult.pageRotations,
      unrotatedResult.pageDimensions
    );

    // Use rotated thumbnail for file manager
    processedFile.thumbnailUrl = rotatedResult.thumbnail;

    if (unrotatedResult.isEncrypted || rotatedResult.isEncrypted) {
      processedFile.isEncrypted = true;
    }

    return processedFile;
  } catch (error) {
    if (DEBUG) console.warn(`📄 Failed to generate processedFileMetadata for ${file.name}:`, error);
  }

  return undefined;
}

/**
 * Create a child PDFoxFileStub from a parent stub with proper history management.
 * Used when a tool processes an existing file to create a new version with incremented history.
 *
 * @param parentStub - The parent PDFoxFileStub to create a child from
 * @param operation - Tool operation information (toolName, timestamp)
 * @param resultingFile - The processed File object
 * @param thumbnail - Optional thumbnail for the child
 * @param processedFileMetadata - Optional fresh metadata for the processed file
 * @returns New child PDFoxFileStub with proper version history
 */
export function createChildStub(
  parentStub: PDFoxFileStub,
  operation: ToolOperation,
  resultingFile: File,
  thumbnail?: string,
  processedFileMetadata?: ProcessedFileMetadata
): PDFoxFileStub {
  const newFileId = createFileId();

  // Build new tool history by appending to parent's history
  const parentToolHistory = parentStub.toolHistory || [];
  const newToolHistory = [...parentToolHistory, operation];

  // Calculate new version number
  const newVersionNumber = (parentStub.versionNumber || 1) + 1;

  // Determine original file ID (root of the version chain)
  const originalFileId = parentStub.originalFileId || parentStub.id;

  // Copy parent metadata but exclude processedFile to prevent stale data
  const { processedFile: _processedFile, ...parentMetadata } = parentStub;

  const childStub = {
    // Copy parent metadata (excluding processedFile)
    ...parentMetadata,

    // Update identity and version info
    id: newFileId,
    versionNumber: newVersionNumber,
    parentFileId: parentStub.id,
    originalFileId: originalFileId,
    toolHistory: newToolHistory,
    createdAt: Date.now(),
    isLeaf: true, // New child is the current leaf node
    name: resultingFile.name,
    size: resultingFile.size,
    type: resultingFile.type,
    lastModified: resultingFile.lastModified,
    thumbnailUrl: thumbnail,

    // Set fresh processedFile metadata (no inheritance from parent)
    processedFile: processedFileMetadata,

    // Mark as dirty if parent has a localFilePath (modified file not yet saved to disk)
    isDirty: parentStub.localFilePath ? true : undefined
  };

  if (DEBUG) {
    console.log('[createChildStub] Created child:', {
      childId: newFileId,
      parentId: parentStub.id,
      parentLocalFilePath: parentStub.localFilePath,
      childLocalFilePath: childStub.localFilePath,
      childIsDirty: childStub.isDirty,
      versionNumber: newVersionNumber
    });
  }

  return childStub;
}

interface AddFileOptions {
  files?: File[];

  // For 'processed' files
  filesWithThumbnails?: Array<{ file: File; thumbnail?: string; pageCount?: number }>;

  // Insertion position
  insertAfterPageId?: string;

  // Auto-selection after adding
  selectFiles?: boolean;

  // Auto-unzip control
  autoUnzip?: boolean;
  autoUnzipFileLimit?: number;
  skipAutoUnzip?: boolean; // When true: always unzip (except HTML). Used for file uploads. When false: respect autoUnzip/autoUnzipFileLimit preferences. Used for tool outputs.
  confirmLargeExtraction?: (fileCount: number, fileName: string) => Promise<boolean>; // Optional callback to confirm extraction of large ZIP files
  allowDuplicates?: boolean;
}

/**
 * Unified file addition helper - replaces addFiles
 */
export async function addFiles(
  options: AddFileOptions,
  stateRef: React.MutableRefObject<FileContextState>,
  filesRef: React.MutableRefObject<Map<FileId, File>>,
  dispatch: React.Dispatch<FileContextAction>,
  lifecycleManager: FileLifecycleManager,
  enablePersistence: boolean = false
): Promise<PDFoxFile[]> {
  // Acquire mutex to prevent race conditions
  await addFilesMutex.lock();

  try {
    const pdfoxFileStubs: PDFoxFileStub[] = [];
    const pdfoxFiles: PDFoxFile[] = [];
    // Hydration tasks are scheduled per-file to update thumbnails/metadata without blocking add flow

  // Build quickKey lookup from existing files for deduplication
  const existingQuickKeys = buildQuickKeySet(stateRef.current.files.byId);

  const { files = [], allowDuplicates = false } = options;

  // ZIP pre-processing: Extract ZIP files with configurable behavior
  // - File uploads: skipAutoUnzip=true → always extract (except HTML)
  // - Tool outputs: skipAutoUnzip=false → respect user preferences
  const filesToProcess: File[] = [];
  const autoUnzip = options.autoUnzip ?? true; // Default to true
  const autoUnzipFileLimit = options.autoUnzipFileLimit ?? 4; // Default limit
  const skipAutoUnzip = options.skipAutoUnzip ?? false;
  const confirmLargeExtraction = options.confirmLargeExtraction;

  for (const file of files) {
    // Check if file is a ZIP
    if (zipFileService.isZipFile(file)) {
      try {
        if (DEBUG) console.log(`📄 addFiles: Detected ZIP file: ${file.name}`);

        // Check if ZIP contains HTML files - if so, keep as ZIP
        const containsHtml = await zipFileService.containsHtmlFiles(file);
        if (containsHtml) {
          if (DEBUG) console.log(`📄 addFiles: ZIP contains HTML, keeping as ZIP: ${file.name}`);
          filesToProcess.push(file);
          continue;
        }

        // Apply extraction with preferences
        const extractedFiles = await zipFileService.extractWithPreferences(file, {
          autoUnzip,
          autoUnzipFileLimit,
          skipAutoUnzip,
          confirmLargeExtraction
        });

        if (extractedFiles.length === 1 && extractedFiles[0] === file) {
          // ZIP was not extracted (over limit or autoUnzip disabled)
          if (DEBUG) console.log(`📄 addFiles: ZIP not extracted (preferences): ${file.name}`);
        } else {
          // ZIP was extracted
          if (DEBUG) console.log(`📄 addFiles: Extracted ${extractedFiles.length} files from ZIP: ${file.name}`);
        }

        filesToProcess.push(...extractedFiles);
      } catch (error) {
        console.error(`📄 addFiles: Failed to process ZIP file ${file.name}:`, error);
        // On error, keep the ZIP file as-is
        filesToProcess.push(file);
      }
    } else {
      // Not a ZIP file, add as-is
      filesToProcess.push(file);
    }
  }

  if (DEBUG) console.log(`📄 addFiles: After ZIP processing, ${filesToProcess.length} files to add`);

  for (const file of filesToProcess) {
    const quickKey = createQuickKey(file);

    // Soft deduplication: Check if file already exists by metadata
    if (!allowDuplicates && existingQuickKeys.has(quickKey)) {
      continue;
    }

    const fileId = createFileId();
    filesRef.current.set(fileId, file);

    // Create new filestub with minimal metadata; hydrate thumbnails/processedFile asynchronously
    const fileStub = createNewPDFoxFileStub(file, fileId);

    // Check for pending file path mapping from Tauri file dialog (desktop only)
    try {
      const { pendingFilePathMappings } = await import('@app/services/pendingFilePathMappings');
      console.log(`[FileActions] Checking for localFilePath mapping for quickKey: ${quickKey}`);
      console.log(`[FileActions] Available mappings:`, Array.from(pendingFilePathMappings.keys()));
      const localFilePath = pendingFilePathMappings.get(quickKey);
      if (localFilePath) {
        console.log(`[FileActions] ✓ Found localFilePath: ${localFilePath}`);
        fileStub.localFilePath = localFilePath;
        pendingFilePathMappings.delete(quickKey); // Clean up after use
        console.log(`[FileActions] Applied localFilePath to file: ${file.name}`);
      } else {
        console.log(`[FileActions] ✗ No localFilePath found for this file`);
      }
    } catch (error) {
      console.log('[FileActions] Could not check for localFilePath:', error);
      // FileManagerContext may not be available in all contexts
    }

    // Store insertion position if provided
    if (options.insertAfterPageId !== undefined) {
      fileStub.insertAfterPageId = options.insertAfterPageId;
    }

    if (!allowDuplicates) {
      existingQuickKeys.add(quickKey);
    }
    pdfoxFileStubs.push(fileStub);

    // Dispatch immediately so each file appears as soon as it is processed
    dispatch({ type: 'ADD_FILES', payload: { pdfoxFileStubs: [fileStub] } });

    // Create PDFoxFile directly
    const pdfoxFile = createPDFoxFile(file, fileId);
    pdfoxFiles.push(pdfoxFile);

    // Queue background hydration so add flow doesn't block on thumbnail/metadata work
    scheduleMetadataHydration(async () => {
      const targetFile = filesRef.current.get(fileId);
      if (!targetFile) {
        return;
      }

      let processedFileMetadata: ProcessedFileMetadata | undefined;
      let thumbnail: string | undefined;

      if (targetFile.type.startsWith('application/pdf')) {
        processedFileMetadata = await generateProcessedFileMetadata(targetFile);
        thumbnail = processedFileMetadata?.thumbnailUrl;
      } else {
        try {
          const { generateThumbnailForFile } = await import('@app/utils/thumbnailUtils');
          thumbnail = await generateThumbnailForFile(targetFile);
        } catch (error) {
          console.warn(`[addFiles] Thumbnail generation failed for ${fileId}:`, error);
        }
      }

      const updates: Partial<PDFoxFileStub> = {};
      const primaryThumbnail = thumbnail || processedFileMetadata?.thumbnailUrl || processedFileMetadata?.pages?.[0]?.thumbnail;

      if (processedFileMetadata) {
        updates.processedFile = processedFileMetadata;
        updates.thumbnailUrl = primaryThumbnail;
      } else if (thumbnail) {
        updates.thumbnailUrl = primaryThumbnail;
      }

      if (primaryThumbnail && primaryThumbnail.startsWith('blob:')) {
        lifecycleManager.trackBlobUrl(primaryThumbnail);
      }

      if (Object.keys(updates).length > 0) {
        lifecycleManager.updatePDFoxFileStub(fileId, updates, stateRef);
      }
    });
  }

  // Persist to storage if enabled using fileStorage service
  if (enablePersistence && pdfoxFiles.length > 0) {
    await Promise.all(pdfoxFiles.map(async (pdfoxFile, index) => {
      try {
        // Get corresponding stub with all metadata
        const fileStub = pdfoxFileStubs[index];

        // Store using the cleaner signature - pass PDFoxFile + PDFoxFileStub directly
        await fileStorage.storePDFoxFile(pdfoxFile, fileStub);

        if (DEBUG) console.log(`📄 addFiles: Stored file ${pdfoxFile.name} with metadata:`, fileStub);
      } catch (error) {
        console.error('Failed to persist file to storage:', pdfoxFile.name, error);
      }
    }));
  }

  return pdfoxFiles;
  } finally {
    // Always release mutex even if error occurs
    addFilesMutex.unlock();
  }
}


/**
 * Consume files helper - replace unpinned input files with output files
 * Now accepts pre-created PDFoxFiles and PDFoxFileStubs to preserve all metadata
 */
export async function consumeFiles(
  inputFileIds: FileId[],
  outputPDFoxFiles: PDFoxFile[],
  outputPDFoxFileStubs: PDFoxFileStub[],
  filesRef: React.MutableRefObject<Map<FileId, File>>,
  dispatch: React.Dispatch<FileContextAction>
): Promise<FileId[]> {
  if (DEBUG) console.log(`📄 consumeFiles: Processing ${inputFileIds.length} input files, ${outputPDFoxFiles.length} output files with pre-created stubs`);

  // Validate that we have matching files and stubs
  if (outputPDFoxFiles.length !== outputPDFoxFileStubs.length) {
    throw new Error(`Mismatch between output files (${outputPDFoxFiles.length}) and stubs (${outputPDFoxFileStubs.length})`);
  }

  // Store PDFoxFiles in filesRef using their existing IDs (no ID generation needed)
  for (let i = 0; i < outputPDFoxFiles.length; i++) {
    const pdfoxFile = outputPDFoxFiles[i];
    const stub = outputPDFoxFileStubs[i];

    if (pdfoxFile.fileId !== stub.id) {
      console.warn(`📄 consumeFiles: ID mismatch between PDFoxFile (${pdfoxFile.fileId}) and stub (${stub.id})`);
    }

    filesRef.current.set(pdfoxFile.fileId, pdfoxFile);

    if (DEBUG) console.log(`📄 consumeFiles: Stored PDFoxFile ${pdfoxFile.name} with ID ${pdfoxFile.fileId}`);
  }

  // Mark input files as processed in storage (no longer leaf nodes)
  if(!outputPDFoxFileStubs.reduce((areAllV1, stub) => areAllV1 && (stub.versionNumber == 1), true)) {
    await Promise.all(
      inputFileIds.map(async (fileId) => {
        try {
          await fileStorage.markFileAsProcessed(fileId);
          if (DEBUG) console.log(`📄 Marked file ${fileId} as processed (no longer leaf)`);
        } catch (error) {
          if (DEBUG) console.warn(`📄 Failed to mark file ${fileId} as processed:`, error);
        }
      })
    );
  }

  // Save output files directly to fileStorage with complete metadata
  for (let i = 0; i < outputPDFoxFiles.length; i++) {
    const pdfoxFile = outputPDFoxFiles[i];
    const stub = outputPDFoxFileStubs[i];

    try {
      // Use fileStorage directly with complete metadata from stub
      await fileStorage.storePDFoxFile(pdfoxFile, stub);

      if (DEBUG) console.log(`📄 Saved PDFoxFile ${pdfoxFile.name} directly to storage with complete metadata:`, {
        fileId: pdfoxFile.fileId,
        versionNumber: stub.versionNumber,
        originalFileId: stub.originalFileId,
        parentFileId: stub.parentFileId,
        toolChainLength: stub.toolHistory?.length || 0
      });
    } catch (error) {
      console.error('Failed to persist output file to fileStorage:', pdfoxFile.name, error);
    }
  }

  // Dispatch the consume action with pre-created stubs (no processing needed)
  dispatch({
    type: 'CONSUME_FILES',
    payload: {
      inputFileIds,
      outputPDFoxFileStubs: outputPDFoxFileStubs
    }
  });

  if (DEBUG) console.log(`📄 consumeFiles: Successfully consumed files - removed ${inputFileIds.length} inputs, added ${outputPDFoxFileStubs.length} outputs`);
  // Return the output file IDs for undo tracking
  return outputPDFoxFileStubs.map(stub => stub.id);
}

/**
 * Helper function to restore files to filesRef and manage IndexedDB cleanup
 */
async function restoreFilesAndCleanup(
  filesToRestore: Array<{ file: File; record: PDFoxFileStub }>,
  fileIdsToRemove: FileId[],
  filesRef: React.MutableRefObject<Map<FileId, File>>,
  indexedDB?: { deleteFile: (fileId: FileId) => Promise<void> } | null
): Promise<void> {
  // Remove files from filesRef
  fileIdsToRemove.forEach(id => {
    if (filesRef.current.has(id)) {
      if (DEBUG) console.log(`📄 Removing file ${id} from filesRef`);
      filesRef.current.delete(id);
    } else {
      if (DEBUG) console.warn(`📄 File ${id} not found in filesRef`);
    }
  });

  // Restore files to filesRef
  filesToRestore.forEach(({ file, record }) => {
    if (file && record) {
      // Validate the file before restoring
      if (file.size === 0) {
        if (DEBUG) console.warn(`📄 Skipping empty file ${file.name}`);
        return;
      }

      // Restore the file to filesRef
      if (DEBUG) console.log(`📄 Restoring file ${file.name} with id ${record.id} to filesRef`);
      filesRef.current.set(record.id, file);
    }
  });

  // Clean up IndexedDB
  if (indexedDB) {
    const indexedDBPromises = fileIdsToRemove.map(fileId =>
      indexedDB.deleteFile(fileId).catch(error => {
        console.error('Failed to delete file from IndexedDB:', fileId, error);
        throw error; // Re-throw to trigger rollback
      })
    );

    // Execute all IndexedDB operations
    await Promise.all(indexedDBPromises);
  }
}

/**
 * Undoes a previous consumeFiles operation by restoring input files and removing output files (unless pinned)
 */
export async function undoConsumeFiles(
  inputFiles: File[],
  inputPDFoxFileStubs: PDFoxFileStub[],
  outputFileIds: FileId[],
  filesRef: React.MutableRefObject<Map<FileId, File>>,
  dispatch: React.Dispatch<FileContextAction>,
  indexedDB?: { saveFile: (file: File, fileId: FileId, existingThumbnail?: string) => Promise<any>; deleteFile: (fileId: FileId) => Promise<void> } | null
): Promise<void> {
  if (DEBUG) console.log(`📄 undoConsumeFiles: Restoring ${inputPDFoxFileStubs.length} input files, removing ${outputFileIds.length} output files`);

  // Validate inputs
  if (inputFiles.length !== inputPDFoxFileStubs.length) {
    throw new Error(`Mismatch between input files (${inputFiles.length}) and records (${inputPDFoxFileStubs.length})`);
  }

  // Create a backup of current filesRef state for rollback
  const backupFilesRef = new Map(filesRef.current);

  try {
    // Prepare files to restore
    const filesToRestore = inputFiles.map((file, index) => ({
      file,
      record: inputPDFoxFileStubs[index]
    }));

    // Restore input files and clean up output files
    await restoreFilesAndCleanup(
      filesToRestore,
      outputFileIds,
      filesRef,
      indexedDB
    );

    // Mark restored files as dirty if they have localFilePath
    // (they now differ from what's saved on disk)
    const stubsWithDirtyMarked = inputPDFoxFileStubs.map(stub => {
      if (stub.localFilePath) {
        return { ...stub, isDirty: true };
      }
      return stub;
    });

    // Dispatch the undo action (only if everything else succeeded)
    dispatch({
      type: 'UNDO_CONSUME_FILES',
      payload: {
        inputPDFoxFileStubs: stubsWithDirtyMarked,
        outputFileIds
      }
    });

    if (DEBUG) console.log(`📄 undoConsumeFiles: Successfully undone consume operation - restored ${inputPDFoxFileStubs.length} inputs, removed ${outputFileIds.length} outputs`);
  } catch (error) {
    // Rollback filesRef to previous state
    if (DEBUG) console.error('📄 undoConsumeFiles: Error during undo, rolling back filesRef', error);
    filesRef.current.clear();
    backupFilesRef.forEach((file, id) => {
      filesRef.current.set(id, file);
    });
    throw error; // Re-throw to let caller handle
  }
}

/**
 * Action factory functions
 */

/**
 * Add files using existing PDFoxFileStubs from storage - preserves all metadata
 * Use this when loading files that already exist in storage (FileManager, etc.)
 * PDFoxFileStubs come with proper thumbnails, history, processing state
 */
export async function addPDFoxFileStubs(
  pdfoxFileStubs: PDFoxFileStub[],
  options: { insertAfterPageId?: string; selectFiles?: boolean } = {},
  stateRef: React.MutableRefObject<FileContextState>,
  filesRef: React.MutableRefObject<Map<FileId, File>>,
  dispatch: React.Dispatch<FileContextAction>,
  lifecycleManager: FileLifecycleManager
): Promise<PDFoxFile[]> {
  await addFilesMutex.lock();

  try {
    // Show loading indicator while preparing files from storage
    if (pdfoxFileStubs.length > 0) {
      dispatch({ type: 'SET_PROCESSING', payload: { isProcessing: true, progress: 0 } });
    }

    const existingQuickKeys = buildQuickKeySet(stateRef.current.files.byId);
    const loadedFiles: PDFoxFile[] = [];
    let firstFileDispatched = false;

    // Process and dispatch files one by one for progressive UI updates
    for (const stub of pdfoxFileStubs) {
      // Check for duplicates using quickKey
      if (existingQuickKeys.has(stub.quickKey || '')) {
        if (DEBUG) console.log(`📄 Skipping duplicate PDFoxFileStub: ${stub.name}`);
        continue;
      }

      // Use the original stub (preserves thumbnails, history, metadata!)
      const record = { ...stub };

      // Store insertion position if provided
      if (options.insertAfterPageId !== undefined) {
        record.insertAfterPageId = options.insertAfterPageId;
      }

      existingQuickKeys.add(stub.quickKey || '');

      // Dispatch each file immediately as we process it (progressive loading)
      dispatch({ type: 'ADD_FILES', payload: { pdfoxFileStubs: [record] } });

      // Clear loading indicator after first file appears
      if (!firstFileDispatched) {
        firstFileDispatched = true;
        dispatch({ type: 'SET_PROCESSING', payload: { isProcessing: false, progress: 0 } });
      }

      // Load File object and hydrate metadata in background (non-blocking)
      const fileId = stub.id;

      // Load File object from IndexedDB asynchronously
      scheduleMetadataHydration(async () => {
        const pdfoxFile = await fileStorage.getPDFoxFile(fileId);
        if (!pdfoxFile) {
          return;
        }

        // Store the loaded file in filesRef
        filesRef.current.set(fileId, pdfoxFile);

        // Check if processedFile data needs regeneration
        if (pdfoxFile.type.startsWith('application/pdf')) {
          const needsProcessing = !stub.processedFile ||
                                  !stub.processedFile.pages ||
                                  stub.processedFile.pages.length === 0 ||
                                  stub.processedFile.totalPages !== stub.processedFile.pages.length;

          if (needsProcessing) {
            // Regenerate metadata
            const processedFileMetadata = await generateProcessedFileMetadata(pdfoxFile);

            if (processedFileMetadata) {
              const updates: Partial<PDFoxFileStub> = {
                processedFile: processedFileMetadata
              };

              // Update thumbnail only if current stub doesn't have one
              const currentStub = stateRef.current.files.byId[fileId];
              if (!currentStub?.thumbnailUrl && processedFileMetadata.thumbnailUrl) {
                updates.thumbnailUrl = processedFileMetadata.thumbnailUrl;
                if (processedFileMetadata.thumbnailUrl.startsWith('blob:')) {
                  lifecycleManager.trackBlobUrl(processedFileMetadata.thumbnailUrl);
                }
              }

              lifecycleManager.updatePDFoxFileStub(fileId, updates, stateRef);
            }
          }
        }
      });
    }

    return loadedFiles;
  } finally {
    addFilesMutex.unlock();
  }
}

export const createFileActions = (dispatch: React.Dispatch<FileContextAction>) => ({
  setSelectedFiles: (fileIds: FileId[]) => dispatch({ type: 'SET_SELECTED_FILES', payload: { fileIds } }),
  setSelectedPages: (pageNumbers: number[]) => dispatch({ type: 'SET_SELECTED_PAGES', payload: { pageNumbers } }),
  clearSelections: () => dispatch({ type: 'CLEAR_SELECTIONS' }),
  setProcessing: (isProcessing: boolean, progress = 0) => dispatch({ type: 'SET_PROCESSING', payload: { isProcessing, progress } }),
  setHasUnsavedChanges: (hasChanges: boolean) => dispatch({ type: 'SET_UNSAVED_CHANGES', payload: { hasChanges } }),
  pinFile: (fileId: FileId) => dispatch({ type: 'PIN_FILE', payload: { fileId } }),
  unpinFile: (fileId: FileId) => dispatch({ type: 'UNPIN_FILE', payload: { fileId } }),
  resetContext: () => dispatch({ type: 'RESET_CONTEXT' }),
  markFileError: (fileId: FileId) => dispatch({ type: 'MARK_FILE_ERROR', payload: { fileId } }),
  clearFileError: (fileId: FileId) => dispatch({ type: 'CLEAR_FILE_ERROR', payload: { fileId } }),
  clearAllFileErrors: () => dispatch({ type: 'CLEAR_ALL_FILE_ERRORS' }),
  updatePDFoxFileStub: (fileId: FileId, updates: Partial<PDFoxFileStub>) => dispatch({ type: 'UPDATE_FILE_RECORD', payload: { id: fileId, updates } })
});
