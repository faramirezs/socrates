/**
 * Base class for markdown exporters implementing Template Method Pattern
 * Provides consistent export structure while allowing customization of headers and footers
 */

import { MarkdownFormatter, ChatSession, ExportOptions, ExportResult } from './types';

/**
 * Abstract base class that defines the template method for exporting chat sessions
 * Subclasses must implement formatHeader() and formatFooter() methods
 */
export abstract class BaseMarkdownExporter {
  protected formatter: MarkdownFormatter;
  protected options: ExportOptions;

  /**
   * Initialize the exporter with a formatter and options
   * @param formatter The markdown formatter to use
   * @param options Export configuration options
   */
  constructor(formatter: MarkdownFormatter, options: ExportOptions = {}) {
    this.formatter = formatter;
    this.options = {
      includeTimestamps: true,
      includeMetadata: true,
      preserveFormatting: true,
      ...options
    };
  }

  /**
   * Abstract method to format the document header
   * Must be implemented by subclasses to provide specific header formatting
   * @returns Formatted header string
   */
  abstract formatHeader(): string;

  /**
   * Abstract method to format the document footer
   * Must be implemented by subclasses to provide specific footer formatting
   * @returns Formatted footer string
   */
  abstract formatFooter(): string;

  /**
   * Template method that defines the export process structure
   * This is the main export method that orchestrates the entire process
   * @param session The chat session to export
   * @returns Export result with content or error information
   */
  export(session: ChatSession): ExportResult {
    const startTime = new Date();

    try {
      // Validate input
      this.validateSession(session);

      // Build the document sections
      const sections: string[] = [];

      // Add header
      sections.push(this.formatHeader());

      // Add metadata if enabled
      if (this.options.includeMetadata) {
        sections.push(this.formatter.formatMetadata(session.metadata));
      }

      // Add messages
      const messagesSection = this.formatMessages(session);
      if (messagesSection) {
        sections.push(messagesSection);
      }

      // Add footer
      sections.push(this.formatFooter());

      // Combine all sections
      const content = this.combineSection(sections);

      // Return successful result
      return {
        success: true,
        content,
        metadata: {
          exportedAt: startTime,
          contentSize: Buffer.byteLength(content, 'utf8'),
          messageCount: session.messages.length
        }
      };

    } catch (error) {
      // Return error result
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown export error',
        metadata: {
          exportedAt: startTime,
          contentSize: 0,
          messageCount: 0
        }
      };
    }
  }

  /**
   * Format all messages in the session
   * @param session The chat session containing messages
   * @returns Formatted messages section
   */
  protected formatMessages(session: ChatSession): string {
    if (!session.messages || session.messages.length === 0) {
      return '## Messages\n\n*No messages in this session*';
    }

    const messageStrings = session.messages.map(message => {
      // Apply timestamp option
      if (!this.options.includeTimestamps) {
        message = { ...message, timestamp: undefined as any };
      }

      return this.formatter.formatMessage(message);
    });

    return `## Messages\n\n${messageStrings.join('\n\n---\n\n')}`;
  }

  /**
   * Combine document sections with proper spacing
   * @param sections Array of document sections
   * @returns Combined document content
   */
  protected combineSection(sections: string[]): string {
    // Filter out empty sections
    const nonEmptySections = sections.filter(section =>
      section && section.trim().length > 0
    );

    // Join with double line breaks for proper markdown spacing
    return nonEmptySections.join('\n\n---\n\n') + '\n';
  }

  /**
   * Validate the session data before export
   * @param session The session to validate
   * @throws Error if session is invalid
   */
  protected validateSession(session: ChatSession): void {
    if (!session) {
      throw new Error('Session cannot be null or undefined');
    }

    if (!session.id) {
      throw new Error('Session must have an ID');
    }

    if (!session.metadata) {
      throw new Error('Session must have metadata');
    }

    if (!session.messages) {
      throw new Error('Session must have a messages array');
    }

    // Validate metadata
    if (!session.metadata.startTime || !session.metadata.endTime) {
      throw new Error('Session metadata must include start and end times');
    }

    if (session.metadata.startTime > session.metadata.endTime) {
      throw new Error('Session start time cannot be after end time');
    }

    // Validate messages
    for (let i = 0; i < session.messages.length; i++) {
      const message = session.messages[i];
      if (!message.role || !['user', 'assistant'].includes(message.role)) {
        throw new Error(`Message ${i} has invalid role: ${message.role}`);
      }

      if (typeof message.content !== 'string') {
        throw new Error(`Message ${i} must have string content`);
      }
    }
  }

  /**
   * Update the formatter used by this exporter
   * @param formatter New formatter to use
   */
  setFormatter(formatter: MarkdownFormatter): void {
    this.formatter = formatter;
  }

  /**
   * Update export options
   * @param options New options to merge with existing options
   */
  setOptions(options: Partial<ExportOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current export options
   * @returns Current export options
   */
  getOptions(): ExportOptions {
    return { ...this.options };
  }
}
