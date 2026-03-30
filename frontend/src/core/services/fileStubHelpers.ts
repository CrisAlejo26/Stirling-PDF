import { PDFoxFile, PDFoxFileStub } from '@app/types/fileContext';
import { createChildStub, generateProcessedFileMetadata } from '@app/contexts/file/fileActions';
import { createPDFoxFile } from '@app/types/fileContext';
import { ToolId } from '@app/types/toolId';

/**
 * Create PDFoxFiles and PDFoxFileStubs from exported files
 * Used when saving page editor changes to create version history
 */
export async function createPDFoxFilesAndStubs(
  files: File[],
  parentStub: PDFoxFileStub,
  toolId: ToolId
): Promise<{ pdfoxFiles: PDFoxFile[], stubs: PDFoxFileStub[] }> {
  const pdfoxFiles: PDFoxFile[] = [];
  const stubs: PDFoxFileStub[] = [];

  for (const file of files) {
    const processedFileMetadata = await generateProcessedFileMetadata(file);
    const childStub = createChildStub(
      parentStub,
      { toolId, timestamp: Date.now() },
      file,
      processedFileMetadata?.thumbnailUrl,
      processedFileMetadata
    );

    const pdfoxFile = createPDFoxFile(file, childStub.id);
    pdfoxFiles.push(pdfoxFile);
    stubs.push(childStub);
  }

  return { pdfoxFiles, stubs };
}
