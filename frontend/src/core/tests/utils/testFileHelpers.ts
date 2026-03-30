/**
 * Test utilities for creating PDFoxFile objects in tests
 */

import { PDFoxFile, createPDFoxFile } from '@app/types/fileContext';

/**
 * Create a PDFoxFile object for testing purposes
 */
export function createTestPDFoxFile(
  name: string,
  content: string = 'test content',
  type: string = 'application/pdf'
): PDFoxFile {
  const file = new File([content], name, { type });
  return createPDFoxFile(file);
}

/**
 * Create multiple PDFoxFile objects for testing
 */
export function createTestFilesWithId(
  files: Array<{ name: string; content?: string; type?: string }>
): PDFoxFile[] {
  return files.map(({ name, content = 'test content', type = 'application/pdf' }) =>
    createTestPDFoxFile(name, content, type)
  );
}