/**
 * PDFox File Storage Service
 * Single-table architecture with typed query methods
 * Forces correct usage patterns through service API design
 */

import { FileId, BaseFileMetadata } from '@app/types/file';
import { PDFoxFile, PDFoxFileStub, createPDFoxFile } from '@app/types/fileContext';
import { indexedDBManager, DATABASE_CONFIGS } from '@app/services/indexedDBManager';

/**
 * Storage record - single source of truth
 * Contains all data needed for both PDFoxFile and PDFoxFileStub
 */
export interface StoredPDFoxFileRecord extends BaseFileMetadata {
  data: ArrayBuffer;
  fileId: FileId; // Matches runtime PDFoxFile.fileId exactly
  quickKey: string; // Matches runtime PDFoxFile.quickKey exactly
  thumbnail?: string;
  url?: string; // For compatibility with existing components
}

export interface StorageStats {
  used: number;
  available: number;
  fileCount: number;
  quota?: number;
}

class FileStorageService {
  private readonly dbConfig = DATABASE_CONFIGS.FILES;
  private readonly storeName = 'files';

  /**
   * Get database connection using centralized manager
   */
  private async getDatabase(): Promise<IDBDatabase> {
    return indexedDBManager.openDatabase(this.dbConfig);
  }

  /**
   * Store a PDFoxFile with its metadata from PDFoxFileStub
   */
  async storePDFoxFile(pdfoxFile: PDFoxFile, stub: PDFoxFileStub): Promise<void> {
    const db = await this.getDatabase();
    const arrayBuffer = await pdfoxFile.arrayBuffer();

    const record: StoredPDFoxFileRecord = {
      id: pdfoxFile.fileId,
      fileId: pdfoxFile.fileId, // Explicit field for clarity
      quickKey: pdfoxFile.quickKey,
      name: pdfoxFile.name,
      type: pdfoxFile.type,
      size: pdfoxFile.size,
      lastModified: pdfoxFile.lastModified,
      createdAt: stub.createdAt,
      data: arrayBuffer,
      thumbnail: stub.thumbnailUrl,
      isLeaf: stub.isLeaf ?? true,
      remoteStorageId: stub.remoteStorageId,
      remoteStorageUpdatedAt: stub.remoteStorageUpdatedAt,
      remoteOwnerUsername: stub.remoteOwnerUsername,
      remoteOwnedByCurrentUser: stub.remoteOwnedByCurrentUser,
      remoteAccessRole: stub.remoteAccessRole,
      remoteSharedViaLink: stub.remoteSharedViaLink,
      remoteHasShareLinks: stub.remoteHasShareLinks,
      remoteShareToken: stub.remoteShareToken,

      // History data from stub
      versionNumber: stub.versionNumber ?? 1,
      originalFileId: stub.originalFileId ?? pdfoxFile.fileId,
      parentFileId: stub.parentFileId ?? undefined,
      toolHistory: stub.toolHistory ?? []
    };

    return new Promise((resolve, reject) => {
      try {
        // Verify store exists before creating transaction
        if (!db.objectStoreNames.contains(this.storeName)) {
          throw new Error(`Object store '${this.storeName}' not found. Available stores: ${Array.from(db.objectStoreNames).join(', ')}`);
        }

        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);

        const request = store.add(record);

        request.onerror = () => {
          console.error('IndexedDB add error:', request.error);
          reject(request.error);
        };
        request.onsuccess = () => {
          resolve();
        };
      } catch (error) {
        console.error('Transaction error:', error);
        reject(error);
      }
    });
  }

  /**
   * Get PDFoxFile with full data - for loading into workbench
   */
  async getPDFoxFile(id: FileId): Promise<PDFoxFile | null> {
    const db = await this.getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const record = request.result as StoredPDFoxFileRecord | undefined;
        if (!record) {
          resolve(null);
          return;
        }

        // Create File from stored data
        const blob = new Blob([record.data], { type: record.type });
        const file = new File([blob], record.name, {
          type: record.type,
          lastModified: record.lastModified
        });

        // Convert to PDFoxFile with preserved IDs
        const pdfoxFile = createPDFoxFile(file, record.fileId);
        resolve(pdfoxFile);
      };
    });
  }

  /**
   * Get multiple PDFoxFiles - for batch loading
   */
  async getPDFoxFiles(ids: FileId[]): Promise<PDFoxFile[]> {
    const results = await Promise.all(ids.map(id => this.getPDFoxFile(id)));
    return results.filter((file): file is PDFoxFile => file !== null);
  }

  /**
   * Get PDFoxFileStub (metadata only) - for UI browsing
   */
  async getPDFoxFileStub(id: FileId): Promise<PDFoxFileStub | null> {
    const db = await this.getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const record = request.result as StoredPDFoxFileRecord | undefined;
        if (!record) {
          resolve(null);
          return;
        }

        // Create PDFoxFileStub from metadata (no file data)
        const stub: PDFoxFileStub = {
          id: record.id,
          name: record.name,
          type: record.type,
          size: record.size,
          lastModified: record.lastModified,
          quickKey: record.quickKey,
          thumbnailUrl: record.thumbnail,
          isLeaf: record.isLeaf,
          remoteStorageId: record.remoteStorageId,
          remoteStorageUpdatedAt: record.remoteStorageUpdatedAt,
          remoteOwnerUsername: record.remoteOwnerUsername,
          remoteOwnedByCurrentUser: record.remoteOwnedByCurrentUser,
          remoteAccessRole: record.remoteAccessRole,
          remoteSharedViaLink: record.remoteSharedViaLink,
          remoteHasShareLinks: record.remoteHasShareLinks,
          remoteShareToken: record.remoteShareToken,
          versionNumber: record.versionNumber,
          originalFileId: record.originalFileId,
          parentFileId: record.parentFileId,
          toolHistory: record.toolHistory,
          createdAt: record.createdAt || Date.now()
        };

        resolve(stub);
      };
    });
  }

  /**
   * Get all PDFoxFileStubs (metadata only) - for FileManager browsing
   */
  async getAllPDFoxFileStubs(): Promise<PDFoxFileStub[]> {
    const db = await this.getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.openCursor();
      const stubs: PDFoxFileStub[] = [];

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const record = cursor.value as StoredPDFoxFileRecord;
          if (record && record.name && typeof record.size === 'number') {
            // Extract metadata only - no file data
            stubs.push({
              id: record.id,
              name: record.name,
              type: record.type,
              size: record.size,
              lastModified: record.lastModified,
              quickKey: record.quickKey,
              thumbnailUrl: record.thumbnail,
              isLeaf: record.isLeaf,
              remoteStorageId: record.remoteStorageId,
              remoteStorageUpdatedAt: record.remoteStorageUpdatedAt,
              remoteOwnerUsername: record.remoteOwnerUsername,
              remoteOwnedByCurrentUser: record.remoteOwnedByCurrentUser,
              remoteAccessRole: record.remoteAccessRole,
              remoteSharedViaLink: record.remoteSharedViaLink,
              remoteHasShareLinks: record.remoteHasShareLinks,
              remoteShareToken: record.remoteShareToken,
              versionNumber: record.versionNumber || 1,
              originalFileId: record.originalFileId || record.id,
              parentFileId: record.parentFileId,
              toolHistory: record.toolHistory || [],
              createdAt: record.createdAt || Date.now()
            });
          }
          cursor.continue();
        } else {
          resolve(stubs);
        }
      };
    });
  }

  /**
   * Get all history stubs for a given original file ID.
   */
  async getHistoryChainStubs(originalFileId: FileId): Promise<PDFoxFileStub[]> {
    const stubs = await this.getAllPDFoxFileStubs();
    return stubs
      .filter((stub) => (stub.originalFileId || stub.id) === originalFileId)
      .sort((a, b) => (a.versionNumber || 1) - (b.versionNumber || 1));
  }

  /**
   * Get leaf PDFoxFileStubs only - for unprocessed files
   */
  async getLeafPDFoxFileStubs(): Promise<PDFoxFileStub[]> {
    const db = await this.getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.openCursor();
      const leafStubs: PDFoxFileStub[] = [];

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const record = cursor.value as StoredPDFoxFileRecord;
          // Only include leaf files (default to true if undefined)
          if (record && record.name && typeof record.size === 'number' && record.isLeaf !== false) {
            leafStubs.push({
              id: record.id,
              name: record.name,
              type: record.type,
              size: record.size,
              lastModified: record.lastModified,
              quickKey: record.quickKey,
              thumbnailUrl: record.thumbnail,
              isLeaf: record.isLeaf,
              remoteStorageId: record.remoteStorageId,
              remoteStorageUpdatedAt: record.remoteStorageUpdatedAt,
              remoteOwnerUsername: record.remoteOwnerUsername,
              remoteOwnedByCurrentUser: record.remoteOwnedByCurrentUser,
              remoteAccessRole: record.remoteAccessRole,
              remoteSharedViaLink: record.remoteSharedViaLink,
              remoteHasShareLinks: record.remoteHasShareLinks,
              remoteShareToken: record.remoteShareToken,
              versionNumber: record.versionNumber || 1,
              originalFileId: record.originalFileId || record.id,
              parentFileId: record.parentFileId,
              toolHistory: record.toolHistory || [],
              createdAt: record.createdAt || Date.now()
            });
          }
          cursor.continue();
        } else {
          resolve(leafStubs);
        }
      };
    });
  }

  /**
   * Delete PDFoxFile - single operation, no sync issues
   */
  async deletePDFoxFile(id: FileId): Promise<void> {
    const db = await this.getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Update thumbnail for existing file
   */
  async updateThumbnail(id: FileId, thumbnail: string): Promise<boolean> {
    const db = await this.getDatabase();

    return new Promise((resolve, _reject) => {
      try {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
          const record = getRequest.result as StoredPDFoxFileRecord;
          if (record) {
            record.thumbnail = thumbnail;
            const updateRequest = store.put(record);

            updateRequest.onsuccess = () => {
              resolve(true);
            };
            updateRequest.onerror = () => {
              console.error('Failed to update thumbnail:', updateRequest.error);
              resolve(false);
            };
          } else {
            resolve(false);
          }
        };

        getRequest.onerror = () => {
          console.error('Failed to get file for thumbnail update:', getRequest.error);
          resolve(false);
        };
      } catch (error) {
        console.error('Transaction error during thumbnail update:', error);
        resolve(false);
      }
    });
  }

  /**
   * Clear all stored files
   */
  async clearAll(): Promise<void> {
    const db = await this.getDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<StorageStats> {
    let used: number;
    let fileCount: number;
    let available = 0;
    let quota: number | undefined;

    try {
      // Get browser quota for context
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        quota = estimate.quota;
        available = estimate.quota || 0;
      }

      // Calculate our actual IndexedDB usage from file metadata
      const stubs = await this.getAllPDFoxFileStubs();
      used = stubs.reduce((total, stub) => total + (stub?.size || 0), 0);
      fileCount = stubs.length;

      // Adjust available space
      if (quota) {
        available = quota - used;
      }

    } catch (error) {
      console.warn('Could not get storage stats:', error);
      used = 0;
      fileCount = 0;
    }

    return {
      used,
      available,
      fileCount,
      quota
    };
  }

  /**
   * Create blob URL for stored file data
   */
  async createBlobUrl(id: FileId): Promise<string | null> {
    try {
      const db = await this.getDatabase();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(id);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const record = request.result as StoredPDFoxFileRecord | undefined;
          if (record) {
            const blob = new Blob([record.data], { type: record.type });
            const url = URL.createObjectURL(blob);
            resolve(url);
          } else {
            resolve(null);
          }
        };
      });
    } catch (error) {
      console.warn(`Failed to create blob URL for ${id}:`, error);
      return null;
    }
  }

  /**
   * Mark a file as processed (no longer a leaf file)
   * Used when a file becomes input to a tool operation
   */
  async markFileAsProcessed(fileId: FileId): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const record = await new Promise<StoredPDFoxFileRecord | undefined>((resolve, reject) => {
        const request = store.get(fileId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      if (!record) {
        return false; // File not found
      }

      // Update the isLeaf flag to false
      record.isLeaf = false;

      await new Promise<void>((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      return true;
    } catch (error) {
      console.error('Failed to mark file as processed:', error);
      return false;
    }
  }

  /**
   * Mark a file as leaf (opposite of markFileAsProcessed)
   * Used when promoting a file back to "recent" status
   */
  async markFileAsLeaf(fileId: FileId): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const record = await new Promise<StoredPDFoxFileRecord | undefined>((resolve, reject) => {
        const request = store.get(fileId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      if (!record) {
        return false; // File not found
      }

      // Update the isLeaf flag to true
      record.isLeaf = true;

      await new Promise<void>((resolve, reject) => {
        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      return true;
    } catch (error) {
      console.error('Failed to mark file as leaf:', error);
      return false;
    }
  }

  /**
   * Update metadata fields for a stored file record.
   */
  async updateFileMetadata(fileId: FileId, updates: Partial<StoredPDFoxFileRecord>): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const record = await new Promise<StoredPDFoxFileRecord | undefined>((resolve, reject) => {
        const request = store.get(fileId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result as StoredPDFoxFileRecord | undefined);
      });

      if (!record) {
        return false;
      }

      const updatedRecord = { ...record, ...updates };
      await new Promise<void>((resolve, reject) => {
        const request = store.put(updatedRecord);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      return true;
    } catch (error) {
      console.error('Failed to update file metadata:', error);
      return false;
    }
  }
}

// Export singleton instance
export const fileStorage = new FileStorageService();

// Helper hook for React components
export function useFileStorage() {
  return fileStorage;
}
