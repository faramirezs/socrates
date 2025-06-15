"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformPathResolver = void 0;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
/**
 * PlatformPathResolver handles OS-specific VS Code storage path detection
 * Supports macOS, Windows, and Linux platforms with validation
 */
class PlatformPathResolver {
    constructor() {
        this.platformConfig = null;
    }
    /**
     * Get the VS Code storage path for the current platform
     * @returns Promise<PathValidationResult> The validated storage path
     */
    async getVSCodeStoragePath() {
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
        }
        catch (error) {
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
    getPlatformConfig() {
        if (this.platformConfig) {
            return this.platformConfig;
        }
        const platform = process.platform;
        const homeDir = os.homedir();
        if (!PlatformPathResolver.SUPPORTED_PLATFORMS.includes(platform)) {
            throw new Error(`Unsupported platform: ${platform}. Supported platforms: ${PlatformPathResolver.SUPPORTED_PLATFORMS.join(', ')}`);
        }
        let basePath;
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
    async validateStoragePath(storagePath) {
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
            }
            catch {
                return {
                    isValid: false,
                    error: `No read access to VS Code storage directory: ${storagePath}`
                };
            }
            return {
                isValid: true,
                path: storagePath
            };
        }
        catch (error) {
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
    async tryAlternativeCodePaths(baseConfig) {
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
    getPlatformDetails() {
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
    resetCache() {
        this.platformConfig = null;
    }
}
exports.PlatformPathResolver = PlatformPathResolver;
PlatformPathResolver.SUPPORTED_PLATFORMS = ['darwin', 'win32', 'linux'];
PlatformPathResolver.WORKSPACE_STORAGE_FOLDER = 'workspaceStorage';
PlatformPathResolver.CODE_FOLDERS = ['Code', 'Code - Insiders', 'VSCodium'];
//# sourceMappingURL=PlatformPathResolver.js.map