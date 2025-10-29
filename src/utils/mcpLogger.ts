/**
 * MCP Structured Logger
 * 
 * Provides structured logging utilities specifically for MCP tool operations
 */

// Import CommonJS modules
const { logger, sensitiveLogger } = require('./logger.js');
const { logSecurityEvent } = require('./securityLogger.js');

interface McpLogContext {
    toolName: string;
    userId?: string;
    workflowName?: string;
    nodeId?: string;
    operation?: string;
    [key: string]: any;
}

/**
 * Structured logger for MCP tool operations
 */
export class McpLogger {
    private context: McpLogContext;

    constructor(context: McpLogContext) {
        this.context = context;
    }

    /**
     * Log debug information
     */
    debug(message: string, data?: any): void {
        logger.debug(`[MCP:${this.context.toolName}] ${message}`, {
            ...this.context,
            ...(data && { data })
        });
    }

    /**
     * Log informational messages
     */
    info(message: string, data?: any): void {
        logger.info(`[MCP:${this.context.toolName}] ${message}`, {
            ...this.context,
            ...(data && { data })
        });
    }

    /**
     * Log warnings
     */
    warn(message: string, data?: any): void {
        logger.warn(`[MCP:${this.context.toolName}] ${message}`, {
            ...this.context,
            ...(data && { data })
        });
    }

    /**
     * Log errors
     */
    error(message: string, error?: Error | any, data?: any): void {
        logger.error(`[MCP:${this.context.toolName}] ${message}`, {
            ...this.context,
            ...(error && {
                error: error instanceof Error ? {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                } : error
            }),
            ...(data && { data })
        });
    }

    /**
     * Log sensitive information (only when explicitly enabled)
     */
    sensitive(message: string, data?: any): void {
        sensitiveLogger.debug(`[MCP:${this.context.toolName}] ${message}`, {
            ...this.context,
            ...(data && { data })
        });
    }

    /**
 * Log security events (also sends to security logger)
 */
    security(eventType: string, message: string, data?: any): void {
        logger.warn(`[MCP:${this.context.toolName}] SECURITY: ${message}`, {
            ...this.context,
            eventType,
            ...(data && { data })
        });

        // Also log to security logger
        logSecurityEvent({
            level: 'warn',
            eventType: `mcp_${eventType}`,
            userId: this.context.userId || 'anonymous',
            ip: 'localhost', // MCP tools run locally
            details: {
                message,
                ...this.context,
                ...(data && { data })
            }
        });
    }

    /**
     * Create a child logger with additional context
     */
    child(additionalContext: Partial<McpLogContext>): McpLogger {
        return new McpLogger({
            ...this.context,
            ...additionalContext
        });
    }
}

/**
 * Create a new MCP logger instance for a tool
 */
export function createMcpLogger(toolName: string, context?: Partial<McpLogContext>): McpLogger {
    return new McpLogger({
        toolName,
        ...context
    });
}

/**
 * Quick logging functions for common MCP operations
 */
export const mcpLog = {
    toolStart: (toolName: string, params: any, context?: Partial<McpLogContext>) => {
        const mcpLogger = createMcpLogger(toolName, context);
        mcpLogger.debug('Tool execution started', { params });
        return mcpLogger;
    },

    toolSuccess: (mcpLogger: McpLogger, result?: any) => {
        mcpLogger.info('Tool execution completed successfully', { result });
    },

    toolError: (mcpLogger: McpLogger, error: Error | any) => {
        mcpLogger.error('Tool execution failed', error);
    },

    nodeOperation: (mcpLogger: McpLogger, operation: string, nodeId: string, workflowName: string) => {
        return mcpLogger.child({ operation, nodeId, workflowName });
    },

    workflowOperation: (mcpLogger: McpLogger, operation: string, workflowName: string) => {
        return mcpLogger.child({ operation, workflowName });
    }
};
