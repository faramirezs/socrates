export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Circuit is open, blocking calls
  HALF_OPEN = 'HALF_OPEN' // Testing if service has recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number;    // Number of failures before opening circuit
  resetTimeout: number;        // Time in ms before attempting to close circuit
  monitoringWindow: number;    // Time window for failure counting
  successThreshold: number;    // Successes needed to close circuit from half-open
  maxRetries: number;          // Maximum retry attempts
  retryDelay: number;          // Base delay between retries in ms
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
  uptime: number;
  lastStateChange: number;
}

export interface CircuitBreakerResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  circuitState: CircuitState;
  retryAttempt?: number;
}

/**
 * DatabaseCircuitBreaker handles error handling and failure recovery
 * Implements circuit breaker pattern with retry logic and system health monitoring
 */
export class DatabaseCircuitBreaker {
  private static readonly DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeout: 60000,      // 1 minute
    monitoringWindow: 300000, // 5 minutes
    successThreshold: 3,
    maxRetries: 3,
    retryDelay: 1000         // 1 second
  };

  private config: CircuitBreakerConfig;
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | undefined;
  private lastSuccessTime: number | undefined;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private startTime = Date.now();
  private lastStateChange = Date.now();
  private consecutiveSuccesses = 0;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DatabaseCircuitBreaker.DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute an operation with circuit breaker protection
   * @param operation The operation to execute
   * @param operationName Name for logging/debugging
   * @returns Promise<CircuitBreakerResult<T>> Operation result with circuit breaker metadata
   */
  public async execute<T>(
    operation: () => Promise<T>,
    operationName: string = 'database_operation'
  ): Promise<CircuitBreakerResult<T>> {
    this.totalCalls++;

    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.setState(CircuitState.HALF_OPEN);
      } else {
        return {
          success: false,
          error: `Circuit breaker is OPEN for ${operationName}. Blocking operation.`,
          circuitState: this.state
        };
      }
    }

    // Execute operation with retry logic
    return await this.executeWithRetries(operation, operationName);
  }

  /**
   * Execute operation with retry logic
   * @param operation The operation to execute
   * @param operationName Name for logging/debugging
   * @returns Promise<CircuitBreakerResult<T>> Operation result
   */
  private async executeWithRetries<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<CircuitBreakerResult<T>> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await operation();
        this.onSuccess();
        return {
          success: true,
          data: result,
          circuitState: this.state,
          retryAttempt: attempt
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on the last attempt
        if (attempt < this.config.maxRetries) {
          const delay = this.calculateRetryDelay(attempt);
          await this.sleep(delay);
        }
      }
    }

    // All retries failed
    this.onFailure(lastError);
    return {
      success: false,
      error: `${operationName} failed after ${this.config.maxRetries + 1} attempts: ${lastError?.message}`,
      circuitState: this.state,
      retryAttempt: this.config.maxRetries
    };
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.successCount++;
    this.totalSuccesses++;
    this.consecutiveSuccesses++;
    this.lastSuccessTime = Date.now();

    // Reset failure count in the monitoring window
    this.cleanupOldFailures();

    // If circuit is half-open and we have enough successes, close it
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.setState(CircuitState.CLOSED);
        this.failureCount = 0;
        this.consecutiveSuccesses = 0;
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  /**
   * Handle failed operation
   * @param error The error that occurred
   */
  private onFailure(error?: Error): void {
    this.failureCount++;
    this.totalFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();

    // Clean up old failures to maintain sliding window
    this.cleanupOldFailures();

    // Check if we should open the circuit
    if (this.state === CircuitState.CLOSED || this.state === CircuitState.HALF_OPEN) {
      if (this.failureCount >= this.config.failureThreshold) {
        this.setState(CircuitState.OPEN);
      }
    }
  }

  /**
   * Check if we should attempt to reset the circuit
   * @returns boolean True if reset should be attempted
   */
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) {
      return true;
    }

    return (Date.now() - this.lastFailureTime) >= this.config.resetTimeout;
  }

  /**
   * Calculate retry delay with exponential backoff
   * @param attempt Current attempt number
   * @returns number Delay in milliseconds
   */
  private calculateRetryDelay(attempt: number): number {
    const exponentialDelay = this.config.retryDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // Add 10% jitter
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Clean up old failures outside the monitoring window
   */
  private cleanupOldFailures(): void {
    if (!this.lastFailureTime) {
      return;
    }

    const cutoffTime = Date.now() - this.config.monitoringWindow;
    if (this.lastFailureTime < cutoffTime) {
      this.failureCount = 0;
    }
  }

  /**
   * Set circuit state and update timestamp
   * @param newState New circuit state
   */
  private setState(newState: CircuitState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.lastStateChange = Date.now();
    }
  }

  /**
   * Sleep for specified duration
   * @param ms Milliseconds to sleep
   * @returns Promise<void>
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current circuit breaker statistics
   * @returns CircuitBreakerStats Current stats
   */
  public getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      uptime: Date.now() - this.startTime,
      lastStateChange: this.lastStateChange
    };
  }

  /**
   * Get circuit health information
   * @returns object Health metrics
   */
  public getHealth(): object {
    const stats = this.getStats();
    const successRate = stats.totalCalls > 0 ? (stats.totalSuccesses / stats.totalCalls) * 100 : 0;
    const timeSinceLastFailure = stats.lastFailureTime ? Date.now() - stats.lastFailureTime : null;
    const timeSinceLastSuccess = stats.lastSuccessTime ? Date.now() - stats.lastSuccessTime : null;

    return {
      healthy: this.state === CircuitState.CLOSED,
      state: this.state,
      successRate: Math.round(successRate * 100) / 100,
      recentFailures: this.failureCount,
      timeSinceLastFailure,
      timeSinceLastSuccess,
      uptime: stats.uptime,
      config: this.config
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  public reset(): void {
    this.setState(CircuitState.CLOSED);
    this.failureCount = 0;
    this.successCount = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
  }

  /**
   * Manually open the circuit breaker
   */
  public open(): void {
    this.setState(CircuitState.OPEN);
    this.lastFailureTime = Date.now();
  }

  /**
   * Update circuit breaker configuration
   * @param newConfig New configuration options
   */
  public updateConfig(newConfig: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   * @returns CircuitBreakerConfig Current configuration
   */
  public getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  /**
   * Check if circuit is currently healthy
   * @returns boolean True if circuit can accept operations
   */
  public isHealthy(): boolean {
    return this.state === CircuitState.CLOSED || this.state === CircuitState.HALF_OPEN;
  }

  /**
   * Get a human-readable status description
   * @returns string Status description
   */
  public getStatusDescription(): string {
    const stats = this.getStats();

    switch (this.state) {
      case CircuitState.CLOSED:
        return `Circuit is CLOSED. ${stats.totalSuccesses} successes, ${stats.totalFailures} failures total.`;

      case CircuitState.OPEN:
        const timeUntilReset = this.lastFailureTime ?
          Math.max(0, this.config.resetTimeout - (Date.now() - this.lastFailureTime)) : 0;
        return `Circuit is OPEN due to ${this.failureCount} recent failures. Will attempt reset in ${Math.round(timeUntilReset / 1000)}s.`;

      case CircuitState.HALF_OPEN:
        return `Circuit is HALF_OPEN. Testing recovery with ${this.consecutiveSuccesses}/${this.config.successThreshold} successful attempts.`;

      default:
        return `Circuit is in unknown state: ${this.state}`;
    }
  }
}
