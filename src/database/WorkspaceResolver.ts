import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { PlatformPathResolver, PathValidationResult } from './PlatformPathResolver';

export interface WorkspaceInfo {
  workspacePath: string;
  workspaceId: string;
  databasePath: string;
  isValid: boolean;
  error?: string;
}

export interface DatabaseDiscoveryResult {
  found: boolean;
  databases: WorkspaceDatabase[];
  error?: string;
}

export interface WorkspaceDatabase {
  workspaceId: string;
  databasePath: string;
  lastModified: Date;
  size: number;
  isAccessible: boolean;
}

/**
 * WorkspaceResolver handles workspace folder to VS Code hashed ID mapping
 * and locates corresponding state.vscdb files
 */
export class WorkspaceResolver {
  private platformResolver: PlatformPathResolver;
  private workspaceCache = new Map<string, WorkspaceInfo>();

  constructor(platformResolver?: PlatformPathResolver) {
    this.platformResolver = platformResolver || new PlatformPathResolver();
  }

  /**
   * Get workspace information for the current VS Code workspace
   * @returns Promise<WorkspaceInfo> Workspace details with database path
   */
  public async getCurrentWorkspaceInfo(): Promise<WorkspaceInfo> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return {
          workspacePath: '',
          workspaceId: '',
          databasePath: '',
          isValid: false,
          error: 'No workspace folder is currently open in VS Code'
        };
      }

      // Use the first workspace folder as primary
      const primaryWorkspace = workspaceFolders[0];
      return await this.getWorkspaceInfo(primaryWorkspace.uri.fsPath);
    } catch (error) {
      return {
        workspacePath: '',
        workspaceId: '',
        databasePath: '',
        isValid: false,
        error: `Failed to get current workspace info: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get workspace information for a specific workspace path
   * @param workspacePath The absolute path to the workspace folder
   * @returns Promise<WorkspaceInfo> Workspace details with database path
   */
  public async getWorkspaceInfo(workspacePath: string): Promise<WorkspaceInfo> {
    // Check cache first
    if (this.workspaceCache.has(workspacePath)) {
      const cached = this.workspaceCache.get(workspacePath)!;
      // Verify cached database still exists
      if (fs.existsSync(cached.databasePath)) {
        return cached;
      } else {
        this.workspaceCache.delete(workspacePath);
      }
    }

    try {
      // Normalize the workspace path
      const normalizedPath = path.resolve(workspacePath);

      // Generate workspace ID using VS Code's hashing algorithm
      const workspaceId = this.generateWorkspaceId(normalizedPath);

      // Get VS Code storage path
      const storageResult = await this.platformResolver.getVSCodeStoragePath();
      if (!storageResult.isValid || !storageResult.path) {
        return {
          workspacePath: normalizedPath,
          workspaceId,
          databasePath: '',
          isValid: false,
          error: storageResult.error || 'Failed to get VS Code storage path'
        };
      }

      // Construct database path
      const databasePath = path.join(storageResult.path, workspaceId, 'state.vscdb');

      // Validate database exists and is accessible
      const isValid = await this.validateDatabasePath(databasePath);

      const workspaceInfo: WorkspaceInfo = {
        workspacePath: normalizedPath,
        workspaceId,
        databasePath,
        isValid,
        error: isValid ? undefined : `Database file not found or not accessible: ${databasePath}`
      };

      // Cache the result
      this.workspaceCache.set(workspacePath, workspaceInfo);

      return workspaceInfo;
    } catch (error) {
      return {
        workspacePath: workspacePath,
        workspaceId: '',
        databasePath: '',
        isValid: false,
        error: `Failed to resolve workspace info: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Generate a workspace ID using VS Code's hashing algorithm
   * Based on VS Code's workspace ID generation logic
   * @param workspacePath The absolute workspace path
   * @returns string The generated workspace ID hash
   */
  public generateWorkspaceId(workspacePath: string): string {
    try {
      // Normalize path separators and resolve to absolute path
      const normalizedPath = path.resolve(workspacePath).toLowerCase();

      // VS Code uses a specific algorithm to generate workspace IDs
      // This mimics the VS Code workspace ID generation
      const hash = crypto.createHash('md5');
      hash.update(normalizedPath);

      // VS Code uses the first 32 characters of the hash
      return hash.digest('hex').substring(0, 32);
    } catch (error) {
      throw new Error(`Failed to generate workspace ID: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Discover all available workspace databases in VS Code storage
   * @returns Promise<DatabaseDiscoveryResult> All found databases with metadata
   */
  public async discoverWorkspaceDatabases(): Promise<DatabaseDiscoveryResult> {
    try {
      const storageResult = await this.platformResolver.getVSCodeStoragePath();
      if (!storageResult.isValid || !storageResult.path) {
        return {
          found: false,
          databases: [],
          error: storageResult.error || 'Failed to get VS Code storage path'
        };
      }

      const databases: WorkspaceDatabase[] = [];
      const workspaceDirectories = await fs.promises.readdir(storageResult.path);

      for (const workspaceId of workspaceDirectories) {
        const workspacePath = path.join(storageResult.path, workspaceId);
        const databasePath = path.join(workspacePath, 'state.vscdb');

        try {
          // Check if it's a directory and contains state.vscdb
          const workspaceStats = await fs.promises.stat(workspacePath);
          if (!workspaceStats.isDirectory()) {
            continue;
          }

          if (await this.validateDatabasePath(databasePath)) {
            const dbStats = await fs.promises.stat(databasePath);
            databases.push({
              workspaceId,
              databasePath,
              lastModified: dbStats.mtime,
              size: dbStats.size,
              isAccessible: true
            });
          }
        } catch {
          // Skip inaccessible or invalid workspace directories
          continue;
        }
      }

      return {
        found: databases.length > 0,
        databases: databases.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime()), // Sort by most recent
        error: databases.length === 0 ? 'No accessible workspace databases found' : undefined
      };
    } catch (error) {
      return {
        found: false,
        databases: [],
        error: `Failed to discover workspace databases: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Validate that a database path exists and is accessible
   * @param databasePath The path to the state.vscdb file
   * @returns Promise<boolean> True if database is valid and accessible
   */
  private async validateDatabasePath(databasePath: string): Promise<boolean> {
    try {
      // Check if file exists
      if (!fs.existsSync(databasePath)) {
        return false;
      }

      // Check if it's a file (not directory)
      const stats = await fs.promises.stat(databasePath);
      if (!stats.isFile()) {
        return false;
      }

      // Check read permissions
      await fs.promises.access(databasePath, fs.constants.R_OK);

      // Basic SQLite file validation (check header)
      const fileHandle = await fs.promises.open(databasePath, 'r');
      try {
        const buffer = Buffer.alloc(16);
        await fileHandle.read(buffer, 0, 16, 0);
        const header = buffer.toString('ascii', 0, 15);

        // SQLite files start with "SQLite format 3"
        return header === 'SQLite format 3';
      } finally {
        await fileHandle.close();
      }
    } catch {
      return false;
    }
  }

  /**
   * Find workspace information by workspace ID
   * @param workspaceId The VS Code workspace ID hash
   * @returns Promise<WorkspaceInfo | null> Workspace info if found
   */
  public async findWorkspaceById(workspaceId: string): Promise<WorkspaceInfo | null> {
    try {
      const storageResult = await this.platformResolver.getVSCodeStoragePath();
      if (!storageResult.isValid || !storageResult.path) {
        return null;
      }

      const databasePath = path.join(storageResult.path, workspaceId, 'state.vscdb');
      const isValid = await this.validateDatabasePath(databasePath);

      if (!isValid) {
        return null;
      }

      return {
        workspacePath: '', // Unknown for reverse lookup
        workspaceId,
        databasePath,
        isValid: true
      };
    } catch {
      return null;
    }
  }

  /**
   * Clear the workspace cache
   */
  public clearCache(): void {
    this.workspaceCache.clear();
  }

  /**
   * Get cache statistics for debugging
   * @returns object Cache information
   */
  public getCacheStats(): object {
    return {
      cacheSize: this.workspaceCache.size,
      cachedWorkspaces: Array.from(this.workspaceCache.keys())
    };
  }
}
