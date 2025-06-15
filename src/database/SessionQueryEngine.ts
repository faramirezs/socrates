import Database from 'better-sqlite3';
import { DatabaseConnectionManager, ConnectionResult } from './DatabaseConnectionManager';

export interface SessionQueryResult {
  success: boolean;
  data?: any;
  error?: string;
  executionTime?: number;
}

export interface SessionMetadata {
  totalSessions: number;
  latestSession?: Date;
  oldestSession?: Date;
  totalSize: number;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  includeMetadata?: boolean;
}

/**
 * SessionQueryEngine handles query execution for interactive.sessions
 * Provides optimized queries with prepared statements and result mapping
 */
export class SessionQueryEngine {
  private static readonly INTERACTIVE_SESSIONS_KEY = 'interactive.sessions';
  private static readonly ITEM_TABLE = 'ItemTable';

  private connectionManager: DatabaseConnectionManager;
  private preparedStatements = new Map<string, Database.Statement>();

  constructor(connectionManager: DatabaseConnectionManager) {
    this.connectionManager = connectionManager;
  }

  /**
   * Get all interactive sessions from the current workspace database
   * @param options Query options for pagination and metadata
   * @returns Promise<SessionQueryResult> Query result with session data
   */
  public async getInteractiveSessions(options: QueryOptions = {}): Promise<SessionQueryResult> {
    const startTime = Date.now();

    try {
      const connectionResult = await this.connectionManager.getCurrentWorkspaceConnection();
      if (!connectionResult.success || !connectionResult.database) {
        return {
          success: false,
          error: connectionResult.error || 'Failed to establish database connection',
          executionTime: Date.now() - startTime
        };
      }

      const database = connectionResult.database;
      const rawData = await this.queryInteractiveSessionsRaw(database);

      if (!rawData.success) {
        return {
          success: false,
          error: rawData.error,
          executionTime: Date.now() - startTime
        };
      }

      // Apply pagination if specified
      let processedData = rawData.data;
      if (options.offset || options.limit) {
        const offset = options.offset || 0;
        const limit = options.limit || processedData.length;
        processedData = processedData.slice(offset, offset + limit);
      }

      // Include metadata if requested
      let metadata: SessionMetadata | undefined;
      if (options.includeMetadata) {
        metadata = this.calculateSessionMetadata(rawData.data);
      }

      return {
        success: true,
        data: {
          sessions: processedData,
          metadata,
          pagination: {
            offset: options.offset || 0,
            limit: options.limit || processedData.length,
            total: rawData.data.length
          }
        },
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        error: `Query execution failed: ${error instanceof Error ? error.message : String(error)}`,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Get a specific session by ID
   * @param sessionId The session ID to retrieve
   * @returns Promise<SessionQueryResult> Single session result
   */
  public async getSessionById(sessionId: string): Promise<SessionQueryResult> {
    const startTime = Date.now();

    try {
      const allSessionsResult = await this.getInteractiveSessions();
      if (!allSessionsResult.success) {
        return {
          success: false,
          error: allSessionsResult.error,
          executionTime: Date.now() - startTime
        };
      }

      const sessions = allSessionsResult.data?.sessions || [];
      const session = sessions.find((s: any) => s.id === sessionId);

      if (!session) {
        return {
          success: false,
          error: `Session with ID ${sessionId} not found`,
          executionTime: Date.now() - startTime
        };
      }

      return {
        success: true,
        data: session,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to retrieve session: ${error instanceof Error ? error.message : String(error)}`,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Get sessions modified since a specific date
   * @param sinceDate Date threshold for filtering sessions
   * @returns Promise<SessionQueryResult> Filtered sessions result
   */
  public async getSessionsSince(sinceDate: Date): Promise<SessionQueryResult> {
    const startTime = Date.now();

    try {
      const allSessionsResult = await this.getInteractiveSessions();
      if (!allSessionsResult.success) {
        return {
          success: false,
          error: allSessionsResult.error,
          executionTime: Date.now() - startTime
        };
      }

      const sessions = allSessionsResult.data?.sessions || [];
      const filteredSessions = sessions.filter((session: any) => {
        if (!session.createdAt) return false;
        const sessionDate = new Date(session.createdAt);
        return sessionDate >= sinceDate;
      });

      return {
        success: true,
        data: {
          sessions: filteredSessions,
          metadata: this.calculateSessionMetadata(filteredSessions),
          filter: {
            sinceDate: sinceDate.toISOString(),
            matchCount: filteredSessions.length,
            totalCount: sessions.length
          }
        },
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to filter sessions: ${error instanceof Error ? error.message : String(error)}`,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Get session metadata without loading full session data
   * @returns Promise<SessionQueryResult> Metadata-only result
   */
  public async getSessionMetadata(): Promise<SessionQueryResult> {
    const startTime = Date.now();

    try {
      const result = await this.getInteractiveSessions({ includeMetadata: true });
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          executionTime: Date.now() - startTime
        };
      }

      return {
        success: true,
        data: result.data?.metadata || {},
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to retrieve metadata: ${error instanceof Error ? error.message : String(error)}`,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Query raw interactive sessions data from the database
   * @param database The database connection
   * @returns Promise<SessionQueryResult> Raw session data
   */
  private async queryInteractiveSessionsRaw(database: Database.Database): Promise<SessionQueryResult> {
    try {
      // Get or create prepared statement
      const statementKey = 'get_interactive_sessions';
      let statement = this.preparedStatements.get(statementKey);

      if (!statement) {
        statement = database.prepare(`
          SELECT value
          FROM ${SessionQueryEngine.ITEM_TABLE}
          WHERE key = ?
        `);
        this.preparedStatements.set(statementKey, statement);
      }

      // Execute query
      const result = statement.get(SessionQueryEngine.INTERACTIVE_SESSIONS_KEY) as { value: string } | undefined;

      if (!result || !result.value) {
        return {
          success: true,
          data: [] // No sessions found, return empty array
        };
      }

      // Parse JSON data
      try {
        const sessions = JSON.parse(result.value);
        if (!Array.isArray(sessions)) {
          return {
            success: false,
            error: 'Interactive sessions data is not in expected array format'
          };
        }

        return {
          success: true,
          data: sessions
        };
      } catch (parseError) {
        return {
          success: false,
          error: `Failed to parse session JSON data: ${parseError instanceof Error ? parseError.message : String(parseError)}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Database query failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Calculate metadata for a collection of sessions
   * @param sessions Array of session objects
   * @returns SessionMetadata Calculated metadata
   */
  private calculateSessionMetadata(sessions: any[]): SessionMetadata {
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return {
        totalSessions: 0,
        totalSize: 0
      };
    }

    const dates: Date[] = [];
    let totalSize = 0;

    for (const session of sessions) {
      // Calculate approximate size
      totalSize += JSON.stringify(session).length;

      // Collect dates
      if (session.createdAt) {
        try {
          dates.push(new Date(session.createdAt));
        } catch {
          // Skip invalid dates
        }
      }
    }

    // Sort dates for min/max calculation
    dates.sort((a, b) => a.getTime() - b.getTime());

    return {
      totalSessions: sessions.length,
      latestSession: dates.length > 0 ? dates[dates.length - 1] : undefined,
      oldestSession: dates.length > 0 ? dates[0] : undefined,
      totalSize
    };
  }

  /**
   * Clear prepared statement cache
   */
  public clearStatementCache(): void {
    this.preparedStatements.clear();
  }

  /**
   * Get query engine statistics
   * @returns object Query engine stats
   */
  public getStats(): object {
    return {
      preparedStatements: this.preparedStatements.size,
      statements: Array.from(this.preparedStatements.keys())
    };
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.clearStatementCache();
  }
}
