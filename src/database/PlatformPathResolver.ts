import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export interface PlatformConfig {
  platform: string;
  basePath: string;
  workspaceStoragePath: string;
  separator: string;
}

export interface PathValidationResult {
  isValid: boolean;
  path?: string;
  error?: string;
}

/**
 * PlatformPathResolver handles OS-specific VS Code storage path detection
 * Supports macOS, Windows, and Linux platforms with validation
 */
export class PlatformPathResolver {
  private static readonly SUPPORTED_PLATFORMS = ['darwin', 'win32', 'linux'];
  private static readonly WORKSPACE_STORAGE_FOLDER = 'workspaceStorage';
  private static readonly CODE_FOLDERS = ['Code', 'Code - Insiders', 'VSCodium'];

  private platformConfig: PlatformConfig | null = null;

  /**
   * Get the VS Code storage path for the current platform
   * @returns Promise<PathValidationResult> The validated storage path
   */
  public async getVSCodeStoragePath(): Promise<PathValidationResult> {
    try {
      const config = this.getPlatformConfig();
      const workspaceStoragePath = path.join(config.basePath, PlatformPathResolver.WORKSPACE_STORAGE_FOLDER);

      const validation = await this.validateStoragePath(workspaceStoragePath);
      if (!validation.isValid) {
        // Try alternative Code installations (Insiders, VSCodium)
        const alternativeResult = await this.tryAlternativeCodePaths(config);
        if (alternativeResult.isValid) {
          return alternativeResult;
        }
      }

      return {
        isValid: validation.isValid,
        path: validation.isValid ? workspaceStoragePath : undefined,
        error: validation.error
      };
    } catch (error) {
      return {
        isValid: false,
        error: `Failed to resolve VS Code storage path: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get platform-specific configuration
   * @returns PlatformConfig The configuration for the current platform
   */
  public getPlatformConfig(): PlatformConfig {
    if (this.platformConfig) {
      return this.platformConfig;
    }

    const platform = process.platform;
    const homeDir = os.homedir();

    if (!PlatformPathResolver.SUPPORTED_PLATFORMS.includes(platform)) {
      throw new Error(`Unsupported platform: ${platform}. Supported platforms: ${PlatformPathResolver.SUPPORTED_PLATFORMS.join(', ')}`);
    }

    let basePath: string;

    switch (platform) {
      case 'darwin': // macOS
        basePath = path.join(homeDir, 'Library', 'Application Support', 'Code', 'User');
        break;
      case 'win32': // Windows
        const appData = process.env.APPDATA;
        if (!appData) {
          throw new Error('APPDATA environment variable not found on Windows');
        }
        basePath = path.join(appData, 'Code', 'User');
        break;
      case 'linux': // Linux
        basePath = path.join(homeDir, '.config', 'Code', 'User');
        break;
      default:
        throw new Error(`Platform ${platform} not handled in switch statement`);
    }

    this.platformConfig = {
      platform,
      basePath,
      workspaceStoragePath: path.join(basePath, PlatformPathResolver.WORKSPACE_STORAGE_FOLDER),
      separator: path.sep
    };

    return this.platformConfig;
  }

  /**
   * Validate that the storage path exists and is accessible
   * @param storagePath The path to validate
   * @returns Promise<PathValidationResult> Validation result
   */
  public async validateStoragePath(storagePath: string): Promise<PathValidationResult> {
    try {
      // Check if path exists
      if (!fs.existsSync(storagePath)) {
        return {
          isValid: false,
          error: `VS Code workspace storage directory not found: ${storagePath}`
        };
      }

      // Check if path is a directory
      const stats = await fs.promises.stat(storagePath);
      if (!stats.isDirectory()) {
        return {
          isValid: false,
          error: `Path exists but is not a directory: ${storagePath}`
        };
      }

      // Check read permissions
      try {
        await fs.promises.access(storagePath, fs.constants.R_OK);
      } catch {
        return {
          isValid: false,
          error: `No read access to VS Code storage directory: ${storagePath}`
        };
      }

      return {
        isValid: true,
        path: storagePath
      };
    } catch (error) {
      return {
        isValid: false,
        error: `Failed to validate storage path: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Try alternative VS Code installation paths (Insiders, VSCodium)
   * @param baseConfig Base platform configuration
   * @returns Promise<PathValidationResult> Alternative path validation result
   */
  private async tryAlternativeCodePaths(baseConfig: PlatformConfig): Promise<PathValidationResult> {
    for (const codeFolder of PlatformPathResolver.CODE_FOLDERS.slice(1)) { // Skip 'Code' as it was already tried
      const alternativeBasePath = baseConfig.basePath.replace('/Code/', `/${codeFolder}/`);
      const alternativeWorkspaceStorage = path.join(alternativeBasePath, PlatformPathResolver.WORKSPACE_STORAGE_FOLDER);

      const validation = await this.validateStoragePath(alternativeWorkspaceStorage);
      if (validation.isValid) {
        return {
          isValid: true,
          path: alternativeWorkspaceStorage
        };
      }
    }

    return {
      isValid: false,
      error: `No valid VS Code installation found. Tried: ${PlatformPathResolver.CODE_FOLDERS.join(', ')}`
    };
  }

  /**
   * Get detailed platform information for debugging
   * @returns object Platform details
   */
  public getPlatformDetails(): object {
    const config = this.getPlatformConfig();
    return {
      platform: config.platform,
      architecture: os.arch(),
      homeDirectory: os.homedir(),
      basePath: config.basePath,
      workspaceStoragePath: config.workspaceStoragePath,
      supportedPlatforms: PlatformPathResolver.SUPPORTED_PLATFORMS,
      nodeVersion: process.version
    };
  }

  /**
   * Reset cached platform configuration (useful for testing)
   */
  public resetCache(): void {
    this.platformConfig = null;
  }
}
