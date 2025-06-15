/**
 * Default implementation of MarkdownFormatter
 * Provides standard formatting for GitHub Copilot chat sessions
 */

import { MarkdownFormatter, ChatMessage, SessionMetadata } from './types';

/**
 * Default markdown formatter that provides clean, readable formatting
 * for chat sessions with proper user/assistant distinction
 */
export class DefaultMarkdownFormatter implements MarkdownFormatter {

  /**
   * Format a chat message with role distinction and content
   * @param message The message to format
   * @returns Formatted markdown string with role indicator and content
   */
  formatMessage(message: ChatMessage): string {
    const role = message.role === 'user' ? '👤 User' : '🤖 Assistant';
    const timestamp = message.timestamp ?
      ` *(${message.timestamp.toLocaleTimeString()})*` : '';

    // Handle code blocks within message content
    const formattedContent = this.formatMessageContent(message.content);

    return `### ${role}${timestamp}\n\n${formattedContent}`;
  }

  /**
   * Format a code block with syntax highlighting
   * @param code The code content
   * @param language The programming language for syntax highlighting
   * @returns Formatted markdown code block
   */
  formatCodeBlock(code: string, language: string): string {
    // Ensure the language is valid for markdown syntax highlighting
    const validLanguage = this.validateLanguage(language);
    return `\`\`\`${validLanguage}\n${code}\n\`\`\``;
  }

  /**
   * Format session metadata into a readable information section
   * @param metadata The session metadata to format
   * @returns Formatted markdown metadata section
   */
  formatMetadata(metadata: SessionMetadata): string {
    const sections = [
      '## Session Information',
      '',
      `- **Start Time**: ${metadata.startTime.toLocaleString()}`,
      `- **End Time**: ${metadata.endTime.toLocaleString()}`,
      `- **Duration**: ${this.formatDuration(metadata.duration)}`,
      `- **Messages**: ${metadata.messageCount}`,
    ];

    // Add optional fields if present
    if (metadata.sessionId) {
      sections.push(`- **Session ID**: ${metadata.sessionId}`);
    }

    if (metadata.title) {
      sections.push(`- **Title**: ${metadata.title}`);
    }

    return sections.join('\n');
  }

  /**
   * Format message content, handling embedded code blocks and special formatting
   * @param content The raw message content
   * @returns Formatted content with proper markdown
   */
  private formatMessageContent(content: string): string {
    // Handle inline code blocks that might be in the content
    let formattedContent = content;

    // Preserve existing code blocks
    formattedContent = formattedContent.replace(
      /```(\w+)?\n([\s\S]*?)\n```/g,
      (match, language, code) => {
        return this.formatCodeBlock(code, language || 'text');
      }
    );

    // Handle inline code
    formattedContent = formattedContent.replace(
      /`([^`]+)`/g,
      '`$1`'
    );

    // Ensure proper line breaks for readability
    formattedContent = formattedContent.replace(/\n\n+/g, '\n\n');

    return formattedContent.trim();
  }

  /**
   * Validate and normalize programming language for syntax highlighting
   * @param language The language identifier
   * @returns Valid language identifier for markdown
   */
  private validateLanguage(language: string): string {
    if (!language) return 'text';

    // Common language mappings
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'sh': 'bash',
      'yml': 'yaml',
      'md': 'markdown',
    };

    const normalized = language.toLowerCase().trim();
    return languageMap[normalized] || normalized;
  }

  /**
   * Format duration in a human-readable way
   * @param minutes Duration in minutes
   * @returns Formatted duration string
   */
  private formatDuration(minutes: number): string {
    if (minutes < 1) {
      return 'Less than 1 minute';
    } else if (minutes < 60) {
      return `${Math.round(minutes)} minute${minutes !== 1 ? 's' : ''}`;
    } else {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = Math.round(minutes % 60);

      if (remainingMinutes === 0) {
        return `${hours} hour${hours !== 1 ? 's' : ''}`;
      } else {
        return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
      }
    }
  }
}
