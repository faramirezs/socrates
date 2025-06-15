"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseCircuitBreaker = exports.CircuitState = void 0;
var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "CLOSED";
    CircuitState["OPEN"] = "OPEN";
    CircuitState["HALF_OPEN"] = "HALF_OPEN"; // Testing if service has recovered
})(CircuitState || (exports.CircuitState = CircuitState = {}));
/**
 * DatabaseCircuitBreaker handles error handling and failure recovery
 * Implements circuit breaker pattern with retry logic and system health monitoring
 */
class DatabaseCircuitBreaker {
    constructor(config) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.totalCalls = 0;
        this.totalFailures = 0;
        this.totalSuccesses = 0;
        this.startTime = Date.now();
        this.lastStateChange = Date.now();
        this.consecutiveSuccesses = 0;
        this.config = { ...DatabaseCircuitBreaker.DEFAULT_CONFIG, ...config };
    }
    /**
     * Execute an operation with circuit breaker protection
     * @param operation The operation to execute
     * @param operationName Name for logging/debugging
     * @returns Promise<CircuitBreakerResult<T>> Operation result with circuit breaker metadata
     */
    async execute(operation, operationName = 'database_operation') {
        this.totalCalls++;
        // Check if circuit is open
        if (this.state === CircuitState.OPEN) {
            if (this.shouldAttemptReset()) {
                this.setState(CircuitState.HALF_OPEN);
            }
            else {
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
    async executeWithRetries(operation, operationName) {
        let lastError;
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
            }
            catch (error) {
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
    onSuccess() {
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
        }
        else if (this.state === CircuitState.CLOSED) {
            // Reset failure count on success in closed state
            this.failureCount = 0;
        }
    }
    /**
     * Handle failed operation
     * @param error The error that occurred
     */
    onFailure(error) {
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
    shouldAttemptReset() {
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
    calculateRetryDelay(attempt) {
        const exponentialDelay = this.config.retryDelay * Math.pow(2, attempt);
        const jitter = Math.random() * 0.1 * exponentialDelay; // Add 10% jitter
        return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
    }
    /**
     * Clean up old failures outside the monitoring window
     */
    cleanupOldFailures() {
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
    setState(newState) {
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
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Get current circuit breaker statistics
     * @returns CircuitBreakerStats Current stats
     */
    getStats() {
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
    getHealth() {
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
    reset() {
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
    open() {
        this.setState(CircuitState.OPEN);
        this.lastFailureTime = Date.now();
    }
    /**
     * Update circuit breaker configuration
     * @param newConfig New configuration options
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
    /**
     * Get current configuration
     * @returns CircuitBreakerConfig Current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Check if circuit is currently healthy
     * @returns boolean True if circuit can accept operations
     */
    isHealthy() {
        return this.state === CircuitState.CLOSED || this.state === CircuitState.HALF_OPEN;
    }
    /**
     * Get a human-readable status description
     * @returns string Status description
     */
    getStatusDescription() {
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
exports.DatabaseCircuitBreaker = DatabaseCircuitBreaker;
DatabaseCircuitBreaker.DEFAULT_CONFIG = {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    monitoringWindow: 300000, // 5 minutes
    successThreshold: 3,
    maxRetries: 3,
    retryDelay: 1000 // 1 second
};
//# sourceMappingURL=DatabaseCircuitBreaker.js.map