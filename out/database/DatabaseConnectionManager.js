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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseConnectionManager = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs = __importStar(require("fs"));
/**
 * DatabaseConnectionManager handles read-only SQLite connection management
 * Provides connection pooling, error handling, and resource cleanup
 */
class DatabaseConnectionManager {
    constructor(workspaceResolver, config) {
        this.activeConnections = new Map();
        this.lastConnectionAttempt = new Map();
        this.RETRY_DELAY = 30000; // 30 seconds between retry attempts
        this.workspaceResolver = workspaceResolver;
        this.connectionConfig = { ...DatabaseConnectionManager.DEFAULT_CONFIG, ...config };
    }
    /**
     * Get a database connection for the current workspace
     * @returns Promise<ConnectionResult> Database connection result
     */
    async getCurrentWorkspaceConnection() {
        try {
            const workspaceInfo = await this.workspaceResolver.getCurrentWorkspaceInfo();
            if (!workspaceInfo.isValid) {
                return {
                    success: false,
                    error: workspaceInfo.error || 'Failed to resolve current workspace'
                };
            }
            return await this.getConnection(workspaceInfo.databasePath);
        }
        catch (error) {
            return {
                success: false,
                error: `Failed to get current workspace connection: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Get a database connection for a specific database path
     * @param databasePath The path to the state.vscdb file
     * @returns Promise<ConnectionResult> Database connection result
     */
    async getConnection(databasePath) {
        try {
            // Check if we should retry (avoid spam)
            const lastAttempt = this.lastConnectionAttempt.get(databasePath);
            if (lastAttempt && (Date.now() - lastAttempt) < this.RETRY_DELAY) {
                return {
                    success: false,
                    error: `Too many recent connection attempts for ${databasePath}. Please wait.`
                };
            }
            // Check if connection already exists and is still valid
            if (this.activeConnections.has(databasePath)) {
                const existingConnection = this.activeConnections.get(databasePath);
                if (this.isConnectionValid(existingConnection)) {
                    return {
                        success: true,
                        database: existingConnection
                    };
                }
                else {
                    // Clean up invalid connection
                    this.closeConnection(databasePath);
                }
            }
            // Validate database file before attempting connection
            const validation = await this.validateDatabaseFile(databasePath);
            if (!validation.isAccessible) {
                this.lastConnectionAttempt.set(databasePath, Date.now());
                return {
                    success: false,
                    error: `Database file is not accessible: ${databasePath}`
                };
            }
            // Create new connection
            const database = new better_sqlite3_1.default(databasePath, this.connectionConfig);
            // Test the connection
            try {
                database.pragma('journal_mode = WAL');
                database.pragma('synchronous = NORMAL');
                database.pragma('cache_size = 1000');
                database.pragma('temp_store = memory');
                // Test query to ensure database is readable
                const result = database.prepare('SELECT name FROM sqlite_master WHERE type=? LIMIT 1').get('table');
                // Store the connection
                this.activeConnections.set(databasePath, database);
                return {
                    success: true,
                    database
                };
            }
            catch (error) {
                // Clean up failed connection
                try {
                    database.close();
                }
                catch {
                    // Ignore cleanup errors
                }
                this.lastConnectionAttempt.set(databasePath, Date.now());
                return {
                    success: false,
                    error: `Database connection test failed: ${error instanceof Error ? error.message : String(error)}`
                };
            }
        }
        catch (error) {
            this.lastConnectionAttempt.set(databasePath, Date.now());
            return {
                success: false,
                error: `Failed to establish database connection: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    /**
     * Get database information without establishing a connection
     * @param databasePath The path to the state.vscdb file
     * @returns Promise<DatabaseInfo | null> Database metadata
     */
    async getDatabaseInfo(databasePath) {
        try {
            const validation = await this.validateDatabaseFile(databasePath);
            if (!validation.isAccessible) {
                return null;
            }
            // Get SQLite version
            let version;
            try {
                const tempDb = new better_sqlite3_1.default(databasePath, { readonly: true, fileMustExist: true });
                try {
                    const versionResult = tempDb.pragma('user_version', { simple: true });
                    version = String(versionResult);
                }
                finally {
                    tempDb.close();
                }
            }
            catch {
                // Version detection failed, but file exists
                version = 'unknown';
            }
            return {
                path: databasePath,
                size: validation.size,
                lastModified: validation.lastModified,
                isAccessible: validation.isAccessible,
                version
            };
        }
        catch (error) {
            return null;
        }
    }
    /**
     * Close a specific database connection
     * @param databasePath The path to the database to close
     */
    closeConnection(databasePath) {
        const connection = this.activeConnections.get(databasePath);
        if (connection) {
            try {
                connection.close();
            }
            catch (error) {
                console.warn(`Error closing database connection for ${databasePath}:`, error);
            }
            finally {
                this.activeConnections.delete(databasePath);
            }
        }
    }
    /**
     * Close all active database connections
     */
    closeAllConnections() {
        const paths = Array.from(this.activeConnections.keys());
        for (const path of paths) {
            this.closeConnection(path);
        }
    }
    /**
     * Get statistics about active connections
     * @returns object Connection statistics
     */
    getConnectionStats() {
        return {
            activeConnections: this.activeConnections.size,
            connectionPaths: Array.from(this.activeConnections.keys()),
            config: this.connectionConfig,
            retryAttempts: this.lastConnectionAttempt.size
        };
    }
    /**
     * Validate database file accessibility and basic properties
     * @param databasePath The path to validate
     * @returns Promise<DatabaseInfo> Validation result with metadata
     */
    async validateDatabaseFile(databasePath) {
        try {
            // Check if file exists
            if (!fs.existsSync(databasePath)) {
                return {
                    path: databasePath,
                    size: 0,
                    lastModified: new Date(0),
                    isAccessible: false
                };
            }
            // Get file stats
            const stats = await fs.promises.stat(databasePath);
            if (!stats.isFile()) {
                return {
                    path: databasePath,
                    size: 0,
                    lastModified: new Date(0),
                    isAccessible: false
                };
            }
            // Check read permissions
            try {
                await fs.promises.access(databasePath, fs.constants.R_OK);
            }
            catch {
                return {
                    path: databasePath,
                    size: stats.size,
                    lastModified: stats.mtime,
                    isAccessible: false
                };
            }
            // Validate SQLite format
            const fileHandle = await fs.promises.open(databasePath, 'r');
            try {
                const buffer = Buffer.alloc(16);
                await fileHandle.read(buffer, 0, 16, 0);
                const header = buffer.toString('ascii', 0, 15);
                const isValidSQLite = header === 'SQLite format 3';
                return {
                    path: databasePath,
                    size: stats.size,
                    lastModified: stats.mtime,
                    isAccessible: isValidSQLite
                };
            }
            finally {
                await fileHandle.close();
            }
        }
        catch (error) {
            return {
                path: databasePath,
                size: 0,
                lastModified: new Date(0),
                isAccessible: false
            };
        }
    }
    /**
     * Check if a database connection is still valid
     * @param database The database connection to check
     * @returns boolean True if connection is valid
     */
    isConnectionValid(database) {
        try {
            // Test with a simple query
            database.prepare('SELECT 1').get();
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Cleanup resources and close all connections
     */
    dispose() {
        this.closeAllConnections();
        this.lastConnectionAttempt.clear();
    }
}
exports.DatabaseConnectionManager = DatabaseConnectionManager;
DatabaseConnectionManager.DEFAULT_CONFIG = {
    readonly: true,
    timeout: 5000,
    verbose: undefined,
    fileMustExist: true
};
//# sourceMappingURL=DatabaseConnectionManager.js.map