/**
 * FileManager handles all file operations for the export system
 * Implements atomic file operations and manages the .socrates directory structure
 */

import * as fs from 'fs';
import * as path from 'path';
import { workspace } from 'vscode';
import { ChatSession } from '../export/types';

/**
 * Configuration options for the FileManager
 */
export interface FileManagerOptions {
  /** Base directory name for storing exported files */
  baseDirectory?: string;
  /** Whether to create subdirectories by date */
  useSubdirectories?: boolean;
  /** Maximum number of retry attempts for file operations */
  maxRetries?: number;
  /** Delay between retry attempts in milliseconds */
  retryDelay?: number;
}

/**
 * Result of a file write operation
 */
export interface WriteResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Full path to the written file */
  filePath?: string;
  /** Error message if operation failed */
  error?: string;
  /** File size in bytes */
  fileSize?: number;
}

/**
 * FileManager class for handling all file operations
 * Provides atomic file writing, directory management, and error recovery
 */
export class FileManager {
  private readonly SOCRATES_DIR = '.socrates';
  private readonly options: Required<FileManagerOptions>;
  private workspaceRoot: string;

  /**
   * Initialize the FileManager
   * @param options Configuration options
   */
  constructor(options: FileManagerOptions = {}) {
    this.options = {
      baseDirectory: this.SOCRATES_DIR,
      useSubdirectories: true,
      maxRetries: 3,
      retryDelay: 1000,
      ...options
    };

    // Get workspace root
    const workspaceFolders = workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('No workspace folder found. FileManager requires an active workspace.');
    }

    this.workspaceRoot = workspaceFolders[0].uri.fsPath;
  }

  /**
   * Write a chat session to a markdown file
   * @param sessionId Unique identifier for the session
   * @param content The markdown content to write
   * @param session Optional session data for enhanced file naming
   * @returns Promise resolving to write result
   */
  async writeSession(sessionId: string, content: string, session?: ChatSession): Promise<WriteResult> {
    try {
      // Ensure the directory structure exists
      await this.ensureDirectoryExists();

      // Generate the file name and path
      const fileName = this.generateFileName(sessionId, session);
      const filePath = await this.getFilePath(fileName);

      // Write the file atomically
      await this.writeFileAtomic(filePath, content);

      // Get file size
      const stats = await fs.promises.stat(filePath);

      return {
        success: true,
        filePath,
        fileSize: stats.size
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown file write error'
      };
    }
  }

  /**
   * Generate a unique file name for a session
   * @param sessionId The session identifier
   * @param session Optional session data for enhanced naming
   * @returns Generated file name
   */
  private generateFileName(sessionId: string, session?: ChatSession): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFileName = `${timestamp}_chat`;

    // Add session-specific information if available
    let fileName = baseFileName;
    if (session?.metadata?.title) {
      // Sanitize title for file name
      const sanitizedTitle = this.sanitizeFileName(session.metadata.title);
      fileName = `${timestamp}_${sanitizedTitle}`;
    }

    return `${fileName}.md`;
  }

  /**
   * Sanitize a string for use in file names
   * @param input The input string to sanitize
   * @returns Sanitized string safe for file names
   */
  private sanitizeFileName(input: string): string {
    return input
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/_{2,}/g, '_') // Replace multiple underscores with single
      .substring(0, 50) // Limit length
      .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
  }

  /**
   * Get the full file path, handling conflicts
   * @param fileName The desired file name
   * @returns Promise resolving to the final file path
   */
  private async getFilePath(fileName: string): Promise<string> {
    const baseDir = this.getBaseDirectory();
    let filePath = path.join(baseDir, fileName);

    // Handle file name conflicts
    let counter = 1;
    while (await this.fileExists(filePath)) {
      const nameWithoutExt = path.parse(fileName).name;
      const ext = path.parse(fileName).ext;
      const newFileName = `${nameWithoutExt}_${counter}${ext}`;
      filePath = path.join(baseDir, newFileName);
      counter++;
    }

    return filePath;
  }

  /**
   * Get the base directory for storing files
   * @returns Base directory path
   */
  private getBaseDirectory(): string {
    let baseDir = path.join(this.workspaceRoot, this.options.baseDirectory);

    // Add subdirectory by date if enabled
    if (this.options.useSubdirectories) {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      baseDir = path.join(baseDir, today);
    }

    return baseDir;
  }

  /**
   * Ensure the directory structure exists
   * @returns Promise that resolves when directory is ready
   */
  private async ensureDirectoryExists(): Promise<void> {
    const baseDir = this.getBaseDirectory();

    try {
      await fs.promises.mkdir(baseDir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create directory ${baseDir}: ${error}`);
    }
  }

  /**
   * Write a file atomically using a temporary file
   * @param filePath The target file path
   * @param content The content to write
   * @returns Promise that resolves when file is written
   */
  private async writeFileAtomic(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    let attempt = 0;

    while (attempt < this.options.maxRetries) {
      try {
        // Write to temporary file
        await fs.promises.writeFile(tempPath, content, 'utf8');

        // Verify the file was written correctly
        const writtenContent = await fs.promises.readFile(tempPath, 'utf8');
        if (writtenContent !== content) {
          throw new Error('File content verification failed');
        }

        // Atomically move to final location
        await fs.promises.rename(tempPath, filePath);

        return; // Success!

      } catch (error) {
        attempt++;

        // Clean up temp file if it exists
        try {
          await fs.promises.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }

        if (attempt >= this.options.maxRetries) {
          throw new Error(`Failed to write file after ${this.options.maxRetries} attempts: ${error}`);
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, this.options.retryDelay));
      }
    }
  }

  /**
   * Check if a file exists
   * @param filePath The file path to check
   * @returns Promise resolving to true if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get information about the storage directory
   * @returns Promise resolving to directory information
   */
  async getDirectoryInfo(): Promise<{
    path: string;
    exists: boolean;
    fileCount: number;
    totalSize: number;
  }> {
    const baseDir = this.getBaseDirectory();

    try {
      const exists = await this.fileExists(baseDir);
      if (!exists) {
        return {
          path: baseDir,
          exists: false,
          fileCount: 0,
          totalSize: 0
        };
      }

      const files = await fs.promises.readdir(baseDir);
      const markdownFiles = files.filter(file => file.endsWith('.md'));

      let totalSize = 0;
      for (const file of markdownFiles) {
        const filePath = path.join(baseDir, file);
        const stats = await fs.promises.stat(filePath);
        totalSize += stats.size;
      }

      return {
        path: baseDir,
        exists: true,
        fileCount: markdownFiles.length,
        totalSize
      };

    } catch (error) {
      throw new Error(`Failed to get directory info: ${error}`);
    }
  }

  /**
   * Clean up old files based on age or count
   * @param maxAge Maximum age in days (optional)
   * @param maxFiles Maximum number of files to keep (optional)
   * @returns Promise resolving to number of files cleaned up
   */
  async cleanupOldFiles(maxAge?: number, maxFiles?: number): Promise<number> {
    const baseDir = this.getBaseDirectory();

    try {
      const exists = await this.fileExists(baseDir);
      if (!exists) return 0;

      const files = await fs.promises.readdir(baseDir);
      const markdownFiles = files.filter(file => file.endsWith('.md'));

      // Get file stats
      const fileStats = await Promise.all(
        markdownFiles.map(async file => {
          const filePath = path.join(baseDir, file);
          const stats = await fs.promises.stat(filePath);
          return { file, filePath, mtime: stats.mtime };
        })
      );

      // Sort by modification time (newest first)
      fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      const filesToDelete: string[] = [];

      // Mark files for deletion based on age
      if (maxAge !== undefined) {
        const cutoffDate = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000);
        fileStats.forEach(({ filePath, mtime }) => {
          if (mtime < cutoffDate) {
            filesToDelete.push(filePath);
          }
        });
      }

      // Mark files for deletion based on count
      if (maxFiles !== undefined && fileStats.length > maxFiles) {
        const excessFiles = fileStats.slice(maxFiles);
        excessFiles.forEach(({ filePath }) => {
          if (!filesToDelete.includes(filePath)) {
            filesToDelete.push(filePath);
          }
        });
      }

      // Delete the files
      for (const filePath of filesToDelete) {
        await fs.promises.unlink(filePath);
      }

      return filesToDelete.length;

    } catch (error) {
      throw new Error(`Failed to cleanup old files: ${error}`);
    }
  }
}
