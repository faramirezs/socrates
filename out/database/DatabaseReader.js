"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseReader = void 0;
const PlatformPathResolver_1 = require("./PlatformPathResolver");
const WorkspaceResolver_1 = require("./WorkspaceResolver");
const DatabaseConnectionManager_1 = require("./DatabaseConnectionManager");
const SessionQueryEngine_1 = require("./SessionQueryEngine");
const SessionDataParser_1 = require("./SessionDataParser");
const DatabaseCircuitBreaker_1 = require("./DatabaseCircuitBreaker");
/**
 * DatabaseReader - Main facade for the layered modular database architecture
 * Coordinates all database components to provide a unified interface for reading chat sessions
 */
class DatabaseReader {
    constructor(config = {}) {
        this.config = {
            enableCircuitBreaker: true,
            strictParsing: true,
            cacheConnections: true,
            ...config
        };
        // Initialize the layered architecture components
        this.platformResolver = new PlatformPathResolver_1.PlatformPathResolver();
        this.workspaceResolver = new WorkspaceResolver_1.WorkspaceResolver(this.platformResolver);
        this.connectionManager = new DatabaseConnectionManager_1.DatabaseConnectionManager(this.workspaceResolver);
        this.queryEngine = new SessionQueryEngine_1.SessionQueryEngine(this.connectionManager);
        this.dataParser = new SessionDataParser_1.SessionDataParser({
            strictMode: this.config.strictParsing,
            allowEmptySessions: false,
            validateTimestamps: true,
            requireSessionId: false
        });
        this.circuitBreaker = new DatabaseCircuitBreaker_1.DatabaseCircuitBreaker();
    }
    /**
     * Get all chat sessions from the current workspace
     * @returns Promise<DatabaseReaderResult> All sessions with metadata
     */
    async getSessions() {
        const startTime = Date.now();
        if (this.config.enableCircuitBreaker) {
            const circuitResult = await this.circuitBreaker.execute(() => this.getSessionsInternal(), 'get_sessions');
            return {
                success: circuitResult.success,
                sessions: circuitResult.data?.sessions,
                error: circuitResult.error,
                metadata: {
                    totalSessions: circuitResult.data?.sessions?.length || 0,
                    processingTime: Date.now() - startTime,
                    circuitBreakerState: circuitResult.circuitState
                }
            };
        }
        else {
            return await this.getSessionsInternal();
        }
    }
    /**
     * Internal method to get sessions without circuit breaker
     * @returns Promise<DatabaseReaderResult> Sessions result
     */
    async getSessionsInternal() {
        const startTime = Date.now();
        try {
            // Step 1: Query raw session data
            const queryResult = await this.queryEngine.getInteractiveSessions({
                includeMetadata: true
            });
            if (!queryResult.success) {
                return {
                    success: false,
                    error: queryResult.error || 'Failed to query sessions',
                    metadata: {
                        totalSessions: 0,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            // Step 2: Parse and validate session data
            const parseResult = this.dataParser.parseSessionData(queryResult.data?.sessions || []);
            if (!parseResult.success) {
                return {
                    success: false,
                    error: parseResult.error || 'Failed to parse sessions',
                    metadata: {
                        totalSessions: 0,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            return {
                success: true,
                sessions: parseResult.data || [],
                metadata: {
                    totalSessions: parseResult.data?.length || 0,
                    processingTime: Date.now() - startTime
                }
            };
        }
        catch (error) {
            return {
                success: false,
                error: `Database reading failed: ${error instanceof Error ? error.message : String(error)}`,
                metadata: {
                    totalSessions: 0,
                    processingTime: Date.now() - startTime
                }
            };
        }
    }
    /**
     * Get a specific session by ID
     * @param sessionId The session ID to retrieve
     * @returns Promise<DatabaseReaderResult> Single session result
     */
    async getSessionById(sessionId) {
        const startTime = Date.now();
        if (this.config.enableCircuitBreaker) {
            const circuitResult = await this.circuitBreaker.execute(() => this.getSessionByIdInternal(sessionId), 'get_session_by_id');
            return {
                success: circuitResult.success,
                sessions: circuitResult.data?.sessions,
                error: circuitResult.error,
                metadata: {
                    totalSessions: circuitResult.data?.sessions?.length || 0,
                    processingTime: Date.now() - startTime,
                    circuitBreakerState: circuitResult.circuitState
                }
            };
        }
        else {
            return await this.getSessionByIdInternal(sessionId);
        }
    }
    /**
     * Internal method to get session by ID without circuit breaker
     * @param sessionId The session ID to retrieve
     * @returns Promise<DatabaseReaderResult> Session result
     */
    async getSessionByIdInternal(sessionId) {
        const startTime = Date.now();
        try {
            const queryResult = await this.queryEngine.getSessionById(sessionId);
            if (!queryResult.success) {
                return {
                    success: false,
                    error: queryResult.error || 'Failed to query session',
                    metadata: {
                        totalSessions: 0,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            // Parse the single session
            const parseResult = this.dataParser.parseSessionData([queryResult.data]);
            if (!parseResult.success || !parseResult.data || parseResult.data.length === 0) {
                return {
                    success: false,
                    error: parseResult.error || 'Failed to parse session',
                    metadata: {
                        totalSessions: 0,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            return {
                success: true,
                sessions: parseResult.data,
                metadata: {
                    totalSessions: 1,
                    processingTime: Date.now() - startTime
                }
            };
        }
        catch (error) {
            return {
                success: false,
                error: `Failed to get session: ${error instanceof Error ? error.message : String(error)}`,
                metadata: {
                    totalSessions: 0,
                    processingTime: Date.now() - startTime
                }
            };
        }
    }
    /**
     * Get sessions modified since a specific date
     * @param sinceDate Date threshold for filtering
     * @returns Promise<DatabaseReaderResult> Filtered sessions
     */
    async getSessionsSince(sinceDate) {
        const startTime = Date.now();
        if (this.config.enableCircuitBreaker) {
            const circuitResult = await this.circuitBreaker.execute(() => this.getSessionsSinceInternal(sinceDate), 'get_sessions_since');
            return {
                success: circuitResult.success,
                sessions: circuitResult.data?.sessions,
                error: circuitResult.error,
                metadata: {
                    totalSessions: circuitResult.data?.sessions?.length || 0,
                    processingTime: Date.now() - startTime,
                    circuitBreakerState: circuitResult.circuitState
                }
            };
        }
        else {
            return await this.getSessionsSinceInternal(sinceDate);
        }
    }
    /**
     * Internal method to get sessions since date without circuit breaker
     * @param sinceDate Date threshold
     * @returns Promise<DatabaseReaderResult> Filtered sessions
     */
    async getSessionsSinceInternal(sinceDate) {
        const startTime = Date.now();
        try {
            const queryResult = await this.queryEngine.getSessionsSince(sinceDate);
            if (!queryResult.success) {
                return {
                    success: false,
                    error: queryResult.error || 'Failed to query sessions',
                    metadata: {
                        totalSessions: 0,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            const parseResult = this.dataParser.parseSessionData(queryResult.data?.sessions || []);
            if (!parseResult.success) {
                return {
                    success: false,
                    error: parseResult.error || 'Failed to parse sessions',
                    metadata: {
                        totalSessions: 0,
                        processingTime: Date.now() - startTime
                    }
                };
            }
            return {
                success: true,
                sessions: parseResult.data || [],
                metadata: {
                    totalSessions: parseResult.data?.length || 0,
                    processingTime: Date.now() - startTime
                }
            };
        }
        catch (error) {
            return {
                success: false,
                error: `Failed to get recent sessions: ${error instanceof Error ? error.message : String(error)}`,
                metadata: {
                    totalSessions: 0,
                    processingTime: Date.now() - startTime
                }
            };
        }
    }
    /**
     * Get system health and status information
     * @returns object Health information
     */
    getSystemHealth() {
        return {
            circuitBreaker: this.circuitBreaker.getHealth(),
            connections: this.connectionManager.getConnectionStats(),
            queryEngine: this.queryEngine.getStats(),
            platform: this.platformResolver.getPlatformDetails(),
            workspace: this.workspaceResolver.getCacheStats(),
            parser: this.dataParser.getValidationOptions(),
            config: this.config
        };
    }
    /**
     * Test the complete database access pipeline
     * @returns Promise<object> Test results
     */
    async testConnection() {
        const testResult = {
            platformResolution: false,
            workspaceResolution: false,
            databaseConnection: false,
            sessionQuery: false,
            dataParsing: false,
            overall: false,
            errors: []
        };
        try {
            // Test platform resolution
            const platformResult = await this.platformResolver.getVSCodeStoragePath();
            testResult.platformResolution = platformResult.isValid;
            if (!platformResult.isValid) {
                testResult.errors.push(`Platform resolution: ${platformResult.error}`);
            }
            // Test workspace resolution
            const workspaceResult = await this.workspaceResolver.getCurrentWorkspaceInfo();
            testResult.workspaceResolution = workspaceResult.isValid;
            if (!workspaceResult.isValid) {
                testResult.errors.push(`Workspace resolution: ${workspaceResult.error}`);
            }
            // Test database connection
            const connectionResult = await this.connectionManager.getCurrentWorkspaceConnection();
            testResult.databaseConnection = connectionResult.success;
            if (!connectionResult.success) {
                testResult.errors.push(`Database connection: ${connectionResult.error}`);
            }
            // Test session query (only if connection works)
            if (testResult.databaseConnection) {
                const queryResult = await this.queryEngine.getSessionMetadata();
                testResult.sessionQuery = queryResult.success;
                if (!queryResult.success) {
                    testResult.errors.push(`Session query: ${queryResult.error}`);
                }
                // Test data parsing (only if query works)
                if (testResult.sessionQuery) {
                    const parseResult = this.dataParser.parseSessionData([]);
                    testResult.dataParsing = parseResult.success;
                    if (!parseResult.success) {
                        testResult.errors.push(`Data parsing: ${parseResult.error}`);
                    }
                }
            }
            testResult.overall = testResult.platformResolution &&
                testResult.workspaceResolution &&
                testResult.databaseConnection &&
                testResult.sessionQuery &&
                testResult.dataParsing;
        }
        catch (error) {
            testResult.errors.push(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return testResult;
    }
    /**
     * Clean up resources and connections
     */
    dispose() {
        this.connectionManager.closeAllConnections();
        this.queryEngine.dispose();
        this.workspaceResolver.clearCache();
        this.platformResolver.resetCache();
    }
}
exports.DatabaseReader = DatabaseReader;
//# sourceMappingURL=DatabaseReader.js.map