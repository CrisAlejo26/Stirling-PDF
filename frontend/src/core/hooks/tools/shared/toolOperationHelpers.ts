import { PDFoxFile, FileId, PDFoxFileStub, createPDFoxFile, ProcessedFileMetadata, createNewPDFoxFileStub } from '@app/types/fileContext';

/**
 * Builds parallel inputFileIds and inputPDFoxFileStubs arrays from the valid input files.
 * Falls back to a fresh stub when the file is not found in the current context state
 * (e.g. it was removed between operation start and this point).
 */
export function buildInputTracking(
  validFiles: PDFoxFile[],
  selectors: { getPDFoxFileStub: (id: FileId) => PDFoxFileStub | undefined }
): { inputFileIds: FileId[]; inputPDFoxFileStubs: PDFoxFileStub[] } {
  const inputFileIds: FileId[] = [];
  const inputPDFoxFileStubs: PDFoxFileStub[] = [];
  for (const file of validFiles) {
    const fileId = file.fileId;
    const record = selectors.getPDFoxFileStub(fileId);
    if (record) {
      inputFileIds.push(fileId);
      inputPDFoxFileStubs.push(record);
    } else {
      console.warn(`No file stub found for file: ${file.name}`);
      inputFileIds.push(fileId);
      inputPDFoxFileStubs.push(createNewPDFoxFileStub(file, fileId));
    }
  }
  return { inputFileIds, inputPDFoxFileStubs };
}

/**
 * Creates parallel outputPDFoxFileStubs and outputPDFoxFiles arrays from processed files.
 * The stubFactory determines how each stub is constructed (child version vs fresh root).
 */
export function buildOutputPairs(
  processedFiles: File[],
  thumbnails: string[],
  metadataArray: Array<ProcessedFileMetadata | undefined>,
  stubFactory: (file: File, thumbnail: string, metadata: ProcessedFileMetadata | undefined, index: number) => PDFoxFileStub
): { outputPDFoxFileStubs: PDFoxFileStub[]; outputPDFoxFiles: PDFoxFile[] } {
  const outputPDFoxFileStubs = processedFiles.map((file, index) =>
    stubFactory(file, thumbnails[index], metadataArray[index], index)
  );
  const outputPDFoxFiles = processedFiles.map((file, index) =>
    createPDFoxFile(file, outputPDFoxFileStubs[index].id)
  );
  return { outputPDFoxFileStubs, outputPDFoxFiles };
}
