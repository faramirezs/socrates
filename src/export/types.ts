/**
 * Core types and interfaces for the export system
 * Implements Template Method Pattern with Strategy for flexible formatting
 */

/**
 * Represents a single chat message from either user or assistant
 */
export interface ChatMessage {
  /** The role of the message sender */
  role: 'user' | 'assistant';
  /** The content of the message */
  content: string;
  /** When the message was created */
  timestamp: Date;
  /** Optional message ID for tracking */
  id?: string;
}

/**
 * Metadata about a chat session
 */
export interface SessionMetadata {
  /** When the session started */
  startTime: Date;
  /** When the session ended */
  endTime: Date;
  /** Total number of messages in the session */
  messageCount: number;
  /** Duration of the session in minutes */
  duration: number;
  /** Optional session ID for tracking */
  sessionId?: string;
  /** Optional session title */
  title?: string;
}

/**
 * Complete chat session data
 */
export interface ChatSession {
  /** Session metadata */
  metadata: SessionMetadata;
  /** Array of messages in the session */
  messages: ChatMessage[];
  /** Unique identifier for the session */
  id: string;
}

/**
 * Strategy interface for formatting different parts of the markdown output
 * Allows customization of how messages, code blocks, and metadata are formatted
 */
export interface MarkdownFormatter {
  /**
   * Format a single chat message
   * @param message The message to format
   * @returns Formatted markdown string
   */
  formatMessage(message: ChatMessage): string;

  /**
   * Format a code block with syntax highlighting
   * @param code The code content
   * @param language The programming language for syntax highlighting
   * @returns Formatted markdown code block
   */
  formatCodeBlock(code: string, language: string): string;

  /**
   * Format session metadata
   * @param metadata The session metadata to format
   * @returns Formatted markdown metadata section
   */
  formatMetadata(metadata: SessionMetadata): string;
}

/**
 * Configuration options for the markdown exporter
 */
export interface ExportOptions {
  /** Whether to include timestamps in messages */
  includeTimestamps?: boolean;
  /** Whether to include session metadata */
  includeMetadata?: boolean;
  /** Custom formatter to use */
  formatter?: MarkdownFormatter;
  /** Whether to preserve original formatting */
  preserveFormatting?: boolean;
}

/**
 * Result of an export operation
 */
export interface ExportResult {
  /** Whether the export was successful */
  success: boolean;
  /** The exported markdown content (if successful) */
  content?: string;
  /** Error message (if failed) */
  error?: string;
  /** Export metadata */
  metadata: {
    /** When the export was performed */
    exportedAt: Date;
    /** Size of the exported content in bytes */
    contentSize: number;
    /** Number of messages exported */
    messageCount: number;
  };
}
