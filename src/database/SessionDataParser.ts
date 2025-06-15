import { ChatMessage } from '../types';

export interface ParsedSession {
  id: string;
  messages: ChatMessage[];
  customTitle?: string;
  createdAt?: string;
  lastModified?: string;
  metadata?: SessionMetadata;
}

export interface SessionMetadata {
  messageCount: number;
  totalCharacters: number;
  userMessageCount: number;
  assistantMessageCount: number;
  firstMessageTimestamp?: number;
  lastMessageTimestamp?: number;
}

export interface ParseResult {
  success: boolean;
  data?: ParsedSession[];
  error?: string;
  warnings?: string[];
  stats?: ParsingStats;
}

export interface ParsingStats {
  totalSessions: number;
  validSessions: number;
  invalidSessions: number;
  totalMessages: number;
  processingTime: number;
}

export interface ValidationOptions {
  strictMode?: boolean;
  allowEmptySessions?: boolean;
  validateTimestamps?: boolean;
  requireSessionId?: boolean;
}

/**
 * SessionDataParser handles JSON parsing, validation, and data transformation
 * for chat sessions with strict type safety and comprehensive error handling
 */
export class SessionDataParser {
  private static readonly DEFAULT_VALIDATION_OPTIONS: ValidationOptions = {
    strictMode: true,
    allowEmptySessions: false,
    validateTimestamps: true,
    requireSessionId: true
  };

  private validationOptions: ValidationOptions;

  constructor(validationOptions?: Partial<ValidationOptions>) {
    this.validationOptions = {
      ...SessionDataParser.DEFAULT_VALIDATION_OPTIONS,
      ...validationOptions
    };
  }

  /**
   * Parse raw session data from the database
   * @param rawData Raw JSON data from the database
   * @returns ParseResult Parsed and validated session data
   */
  public parseSessionData(rawData: any): ParseResult {
    const startTime = Date.now();
    const warnings: string[] = [];

    try {
      // Validate input
      if (!rawData) {
        return {
          success: false,
          error: 'No data provided for parsing',
          warnings,
          stats: this.createEmptyStats(Date.now() - startTime)
        };
      }

      // Ensure data is an array
      let sessionsArray: any[];
      if (Array.isArray(rawData)) {
        sessionsArray = rawData;
      } else if (typeof rawData === 'object') {
        // Handle single session object
        sessionsArray = [rawData];
        warnings.push('Single session object converted to array');
      } else {
        return {
          success: false,
          error: 'Raw data is not in expected format (array or object)',
          warnings,
          stats: this.createEmptyStats(Date.now() - startTime)
        };
      }

      // Parse each session
      const parsedSessions: ParsedSession[] = [];
      let invalidSessionCount = 0;

      for (let i = 0; i < sessionsArray.length; i++) {
        const sessionResult = this.parseIndividualSession(sessionsArray[i], i);

        if (sessionResult.success && sessionResult.data) {
          parsedSessions.push(sessionResult.data);
        } else {
          invalidSessionCount++;
          if (sessionResult.warnings) {
            warnings.push(...sessionResult.warnings);
          }
          if (sessionResult.error) {
            warnings.push(`Session ${i}: ${sessionResult.error}`);
          }
        }
      }

      // Calculate stats
      const totalMessages = parsedSessions.reduce((sum, session) => sum + session.messages.length, 0);
      const stats: ParsingStats = {
        totalSessions: sessionsArray.length,
        validSessions: parsedSessions.length,
        invalidSessions: invalidSessionCount,
        totalMessages,
        processingTime: Date.now() - startTime
      };

      // Determine overall success
      const success = parsedSessions.length > 0;

      return {
        success,
        data: parsedSessions,
        error: success ? undefined : 'No valid sessions could be parsed',
        warnings: warnings.length > 0 ? warnings : undefined,
        stats
      };
    } catch (error) {
      return {
        success: false,
        error: `Parsing failed: ${error instanceof Error ? error.message : String(error)}`,
        warnings,
        stats: this.createEmptyStats(Date.now() - startTime)
      };
    }
  }

  /**
   * Parse a single session object
   * @param sessionData Raw session data
   * @param index Session index for error reporting
   * @returns ParseResult Single session parse result
   */
  private parseIndividualSession(sessionData: any, index: number): { success: boolean; data?: ParsedSession; error?: string; warnings?: string[] } {
    const warnings: string[] = [];

    try {
      // Validate session structure
      if (!sessionData || typeof sessionData !== 'object') {
        return {
          success: false,
          error: `Session data is not an object`,
          warnings
        };
      }

      // Extract session ID
      const sessionId = this.extractSessionId(sessionData, index);
      if (this.validationOptions.requireSessionId && !sessionId) {
        return {
          success: false,
          error: 'Session ID is required but not found',
          warnings
        };
      }

      // Parse messages
      const messagesResult = this.parseMessages(sessionData.messages || []);
      if (!messagesResult.success) {
        return {
          success: false,
          error: messagesResult.error,
          warnings: [...warnings, ...(messagesResult.warnings || [])]
        };
      }

      // Validate empty sessions
      if (!this.validationOptions.allowEmptySessions && messagesResult.data!.length === 0) {
        return {
          success: false,
          error: 'Empty sessions are not allowed',
          warnings
        };
      }

      // Parse timestamps
      const { createdAt, lastModified } = this.parseTimestamps(sessionData);

      // Calculate metadata
      const metadata = this.calculateSessionMetadata(messagesResult.data!);

      const parsedSession: ParsedSession = {
        id: sessionId || `session_${index}`,
        messages: messagesResult.data!,
        customTitle: this.extractCustomTitle(sessionData),
        createdAt,
        lastModified,
        metadata
      };

      return {
        success: true,
        data: parsedSession,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse session: ${error instanceof Error ? error.message : String(error)}`,
        warnings
      };
    }
  }

  /**
   * Parse and validate message array
   * @param messagesData Raw messages data
   * @returns ParseResult Messages parse result
   */
  private parseMessages(messagesData: any): { success: boolean; data?: ChatMessage[]; error?: string; warnings?: string[] } {
    const warnings: string[] = [];

    if (!Array.isArray(messagesData)) {
      return {
        success: false,
        error: 'Messages data is not an array',
        warnings
      };
    }

    const parsedMessages: ChatMessage[] = [];

    for (let i = 0; i < messagesData.length; i++) {
      const messageResult = this.parseIndividualMessage(messagesData[i], i);

      if (messageResult.success && messageResult.data) {
        parsedMessages.push(messageResult.data);
      } else {
        if (this.validationOptions.strictMode) {
          return {
            success: false,
            error: messageResult.error || `Invalid message at index ${i}`,
            warnings: [...warnings, ...(messageResult.warnings || [])]
          };
        } else {
          // Skip invalid messages in non-strict mode
          if (messageResult.warnings) {
            warnings.push(...messageResult.warnings);
          }
          warnings.push(`Skipped invalid message at index ${i}: ${messageResult.error}`);
        }
      }
    }

    return {
      success: true,
      data: parsedMessages,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Parse a single message object
   * @param messageData Raw message data
   * @param index Message index for error reporting
   * @returns ParseResult Single message parse result
   */
  private parseIndividualMessage(messageData: any, index: number): { success: boolean; data?: ChatMessage; error?: string; warnings?: string[] } {
    const warnings: string[] = [];

    try {
      if (!messageData || typeof messageData !== 'object') {
        return {
          success: false,
          error: 'Message data is not an object',
          warnings
        };
      }

      // Validate role
      const role = messageData.role;
      if (!role || (role !== 'user' && role !== 'assistant')) {
        return {
          success: false,
          error: `Invalid or missing role: ${role}`,
          warnings
        };
      }

      // Validate content
      const content = messageData.content;
      if (typeof content !== 'string') {
        return {
          success: false,
          error: 'Message content must be a string',
          warnings
        };
      }

      // Parse timestamp
      let timestamp: number | undefined;
      if (messageData.timestamp !== undefined) {
        if (typeof messageData.timestamp === 'number') {
          timestamp = messageData.timestamp;
        } else if (typeof messageData.timestamp === 'string') {
          const parsed = Date.parse(messageData.timestamp);
          if (!isNaN(parsed)) {
            timestamp = parsed;
          } else {
            warnings.push(`Invalid timestamp format: ${messageData.timestamp}`);
          }
        } else {
          warnings.push(`Timestamp is not a number or string: ${typeof messageData.timestamp}`);
        }
      }

      // Validate timestamp if required
      if (this.validationOptions.validateTimestamps && timestamp !== undefined) {
        const now = Date.now();
        const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);

        if (timestamp > now) {
          warnings.push('Timestamp is in the future');
        } else if (timestamp < oneYearAgo) {
          warnings.push('Timestamp is older than one year');
        }
      }

      const parsedMessage: ChatMessage = {
        role,
        content,
        timestamp
      };

      return {
        success: true,
        data: parsedMessage,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse message: ${error instanceof Error ? error.message : String(error)}`,
        warnings
      };
    }
  }

  /**
   * Extract session ID from session data
   * @param sessionData Raw session data
   * @param index Fallback index
   * @returns string | null Session ID
   */
  private extractSessionId(sessionData: any, index: number): string | null {
    if (sessionData.id && typeof sessionData.id === 'string') {
      return sessionData.id;
    }

    if (sessionData.sessionId && typeof sessionData.sessionId === 'string') {
      return sessionData.sessionId;
    }

    // Generate ID if none found and not in strict mode
    if (!this.validationOptions.requireSessionId) {
      return `generated_session_${index}_${Date.now()}`;
    }

    return null;
  }

  /**
   * Extract custom title from session data
   * @param sessionData Raw session data
   * @returns string | undefined Custom title
   */
  private extractCustomTitle(sessionData: any): string | undefined {
    if (sessionData.customTitle && typeof sessionData.customTitle === 'string') {
      return sessionData.customTitle;
    }

    if (sessionData.title && typeof sessionData.title === 'string') {
      return sessionData.title;
    }

    return undefined;
  }

  /**
   * Parse timestamps from session data
   * @param sessionData Raw session data
   * @returns object Parsed timestamps
   */
  private parseTimestamps(sessionData: any): { createdAt?: string; lastModified?: string } {
    let createdAt: string | undefined;
    let lastModified: string | undefined;

    // Parse createdAt
    if (sessionData.createdAt) {
      if (typeof sessionData.createdAt === 'string') {
        createdAt = sessionData.createdAt;
      } else if (typeof sessionData.createdAt === 'number') {
        createdAt = new Date(sessionData.createdAt).toISOString();
      }
    }

    // Parse lastModified
    if (sessionData.lastModified) {
      if (typeof sessionData.lastModified === 'string') {
        lastModified = sessionData.lastModified;
      } else if (typeof sessionData.lastModified === 'number') {
        lastModified = new Date(sessionData.lastModified).toISOString();
      }
    }

    return { createdAt, lastModified };
  }

  /**
   * Calculate metadata for a session
   * @param messages Array of parsed messages
   * @returns SessionMetadata Calculated metadata
   */
  private calculateSessionMetadata(messages: ChatMessage[]): SessionMetadata {
    let totalCharacters = 0;
    let userMessageCount = 0;
    let assistantMessageCount = 0;
    let firstMessageTimestamp: number | undefined;
    let lastMessageTimestamp: number | undefined;

    for (const message of messages) {
      totalCharacters += message.content.length;

      if (message.role === 'user') {
        userMessageCount++;
      } else if (message.role === 'assistant') {
        assistantMessageCount++;
      }

      if (message.timestamp) {
        if (!firstMessageTimestamp || message.timestamp < firstMessageTimestamp) {
          firstMessageTimestamp = message.timestamp;
        }
        if (!lastMessageTimestamp || message.timestamp > lastMessageTimestamp) {
          lastMessageTimestamp = message.timestamp;
        }
      }
    }

    return {
      messageCount: messages.length,
      totalCharacters,
      userMessageCount,
      assistantMessageCount,
      firstMessageTimestamp,
      lastMessageTimestamp
    };
  }

  /**
   * Create empty parsing stats
   * @param processingTime Time taken for processing
   * @returns ParsingStats Empty stats object
   */
  private createEmptyStats(processingTime: number): ParsingStats {
    return {
      totalSessions: 0,
      validSessions: 0,
      invalidSessions: 0,
      totalMessages: 0,
      processingTime
    };
  }

  /**
   * Update validation options
   * @param newOptions New validation options
   */
  public updateValidationOptions(newOptions: Partial<ValidationOptions>): void {
    this.validationOptions = { ...this.validationOptions, ...newOptions };
  }

  /**
   * Get current validation options
   * @returns ValidationOptions Current options
   */
  public getValidationOptions(): ValidationOptions {
    return { ...this.validationOptions };
  }
}
