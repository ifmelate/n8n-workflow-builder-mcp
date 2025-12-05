const { describe, it, expect, beforeEach } = require('@jest/globals');

// Mock the logger dependencies before importing
jest.mock('../../src/utils/logger', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    },
    sensitiveLogger: {
        debug: jest.fn()
    }
}));

jest.mock('../../src/utils/securityLogger', () => ({
    logSecurityEvent: jest.fn()
}));

const { McpLogger, createMcpLogger, mcpLog } = require('../../src/utils/mcpLogger.ts');
const { logger, sensitiveLogger } = require('../../src/utils/logger');
const { logSecurityEvent } = require('../../src/utils/securityLogger');

describe('MCP Structured Logger', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('McpLogger class', () => {
        let mcpLogger;

        beforeEach(() => {
            mcpLogger = new McpLogger({
                toolName: 'test_tool',
                userId: 'test-user-123',
                workflowName: 'test-workflow'
            });
        });

        describe('debug logging', () => {
            it('should log debug messages with context', () => {
                mcpLogger.debug('Test debug message', { extra: 'data' });

                expect(logger.debug).toHaveBeenCalledWith(
                    '[MCP:test_tool] Test debug message',
                    {
                        toolName: 'test_tool',
                        userId: 'test-user-123',
                        workflowName: 'test-workflow',
                        data: { extra: 'data' }
                    }
                );
            });

            it('should log debug messages without extra data', () => {
                mcpLogger.debug('Simple debug message');

                expect(logger.debug).toHaveBeenCalledWith(
                    '[MCP:test_tool] Simple debug message',
                    {
                        toolName: 'test_tool',
                        userId: 'test-user-123',
                        workflowName: 'test-workflow'
                    }
                );
            });
        });

        describe('info logging', () => {
            it('should log info messages with context', () => {
                mcpLogger.info('Test info message', { result: 'success' });

                expect(logger.info).toHaveBeenCalledWith(
                    '[MCP:test_tool] Test info message',
                    {
                        toolName: 'test_tool',
                        userId: 'test-user-123',
                        workflowName: 'test-workflow',
                        data: { result: 'success' }
                    }
                );
            });
        });

        describe('warn logging', () => {
            it('should log warning messages with context', () => {
                mcpLogger.warn('Test warning message', { warning: 'type' });

                expect(logger.warn).toHaveBeenCalledWith(
                    '[MCP:test_tool] Test warning message',
                    {
                        toolName: 'test_tool',
                        userId: 'test-user-123',
                        workflowName: 'test-workflow',
                        data: { warning: 'type' }
                    }
                );
            });
        });

        describe('error logging', () => {
            it('should log errors with Error objects', () => {
                const testError = new Error('Test error');
                mcpLogger.error('Test error message', testError, { context: 'test' });

                expect(logger.error).toHaveBeenCalledWith(
                    '[MCP:test_tool] Test error message',
                    {
                        toolName: 'test_tool',
                        userId: 'test-user-123',
                        workflowName: 'test-workflow',
                        error: {
                            message: 'Test error',
                            stack: testError.stack,
                            name: 'Error'
                        },
                        data: { context: 'test' }
                    }
                );
            });

            it('should log errors with non-Error objects', () => {
                const errorObj = { code: 'TEST_ERROR', details: 'test details' };
                mcpLogger.error('Test error message', errorObj);

                expect(logger.error).toHaveBeenCalledWith(
                    '[MCP:test_tool] Test error message',
                    {
                        toolName: 'test_tool',
                        userId: 'test-user-123',
                        workflowName: 'test-workflow',
                        error: errorObj
                    }
                );
            });

            it('should log errors without error objects', () => {
                mcpLogger.error('Simple error message');

                expect(logger.error).toHaveBeenCalledWith(
                    '[MCP:test_tool] Simple error message',
                    {
                        toolName: 'test_tool',
                        userId: 'test-user-123',
                        workflowName: 'test-workflow'
                    }
                );
            });
        });

        describe('sensitive logging', () => {
            it('should log sensitive data to sensitive logger', () => {
                mcpLogger.sensitive('Sensitive operation', { apiKey: '[REDACTED]' });

                expect(sensitiveLogger.debug).toHaveBeenCalledWith(
                    '[MCP:test_tool] Sensitive operation',
                    {
                        toolName: 'test_tool',
                        userId: 'test-user-123',
                        workflowName: 'test-workflow',
                        data: { apiKey: '[REDACTED]' }
                    }
                );
            });
        });

        describe('security logging', () => {
            it('should log security events to both loggers', () => {
                mcpLogger.security('path_traversal_attempt', 'Security violation detected', {
                    attemptedPath: '/etc/passwd',
                    ip: '192.168.1.100'
                });

                // Should log to regular logger
                expect(logger.warn).toHaveBeenCalledWith(
                    '[MCP:test_tool] SECURITY: Security violation detected',
                    {
                        toolName: 'test_tool',
                        userId: 'test-user-123',
                        workflowName: 'test-workflow',
                        eventType: 'path_traversal_attempt',
                        data: {
                            attemptedPath: '/etc/passwd',
                            ip: '192.168.1.100'
                        }
                    }
                );

                // Should log to security logger
                expect(logSecurityEvent).toHaveBeenCalledWith({
                    level: 'warn',
                    eventType: 'mcp_path_traversal_attempt',
                    userId: 'test-user-123',
                    ip: 'localhost',
                    details: {
                        message: 'Security violation detected',
                        toolName: 'test_tool',
                        userId: 'test-user-123',
                        workflowName: 'test-workflow',
                        data: {
                            attemptedPath: '/etc/passwd',
                            ip: '192.168.1.100'
                        }
                    }
                });
            });

            it('should handle anonymous users in security logging', () => {
                const anonymousLogger = new McpLogger({
                    toolName: 'test_tool'
                });

                anonymousLogger.security('unauthorized_access', 'Access denied');

                expect(logSecurityEvent).toHaveBeenCalledWith({
                    level: 'warn',
                    eventType: 'mcp_unauthorized_access',
                    userId: 'anonymous',
                    ip: 'localhost',
                    details: {
                        message: 'Access denied',
                        toolName: 'test_tool'
                    }
                });
            });
        });

        describe('child logger', () => {
            it('should create child logger with additional context', () => {
                const childLogger = mcpLogger.child({
                    nodeId: 'node-123',
                    operation: 'create'
                });

                childLogger.info('Child logger test');

                expect(logger.info).toHaveBeenCalledWith(
                    '[MCP:test_tool] Child logger test',
                    {
                        toolName: 'test_tool',
                        userId: 'test-user-123',
                        workflowName: 'test-workflow',
                        nodeId: 'node-123',
                        operation: 'create'
                    }
                );
            });

            it('should override parent context in child logger', () => {
                const childLogger = mcpLogger.child({
                    workflowName: 'new-workflow-name'
                });

                childLogger.debug('Override test');

                expect(logger.debug).toHaveBeenCalledWith(
                    '[MCP:test_tool] Override test',
                    {
                        toolName: 'test_tool',
                        userId: 'test-user-123',
                        workflowName: 'new-workflow-name'
                    }
                );
            });
        });
    });

    describe('createMcpLogger factory', () => {
        it('should create logger with tool name only', () => {
            const mcpLogger = createMcpLogger('test_factory_tool');
            mcpLogger.info('Factory test');

            expect(logger.info).toHaveBeenCalledWith(
                '[MCP:test_factory_tool] Factory test',
                {
                    toolName: 'test_factory_tool'
                }
            );
        });

        it('should create logger with additional context', () => {
            const mcpLogger = createMcpLogger('test_factory_tool', {
                userId: 'factory-user',
                workflowName: 'factory-workflow'
            });

            mcpLogger.warn('Factory warning');

            expect(logger.warn).toHaveBeenCalledWith(
                '[MCP:test_factory_tool] Factory warning',
                {
                    toolName: 'test_factory_tool',
                    userId: 'factory-user',
                    workflowName: 'factory-workflow'
                }
            );
        });
    });

    describe('mcpLog utilities', () => {
        describe('toolStart', () => {
            it('should log tool start and return logger', () => {
                const params = { workflow_name: 'test-workflow', node_id: 'node-123' };
                const mcpLogger = mcpLog.toolStart('test_tool', params, { userId: 'test-user' });

                expect(logger.debug).toHaveBeenCalledWith(
                    '[MCP:test_tool] Tool execution started',
                    {
                        toolName: 'test_tool',
                        userId: 'test-user',
                        data: { params }
                    }
                );

                expect(mcpLogger).toBeInstanceOf(McpLogger);
            });
        });

        describe('toolSuccess', () => {
            it('should log tool success', () => {
                const mcpLogger = createMcpLogger('test_tool');
                const result = { success: true, message: 'Operation completed' };

                mcpLog.toolSuccess(mcpLogger, result);

                expect(logger.info).toHaveBeenCalledWith(
                    '[MCP:test_tool] Tool execution completed successfully',
                    {
                        toolName: 'test_tool',
                        data: { result }
                    }
                );
            });

            it('should log tool success without result', () => {
                const mcpLogger = createMcpLogger('test_tool');

                mcpLog.toolSuccess(mcpLogger);

                expect(logger.info).toHaveBeenCalledWith(
                    '[MCP:test_tool] Tool execution completed successfully',
                    {
                        toolName: 'test_tool',
                        data: { result: undefined }
                    }
                );
            });
        });

        describe('toolError', () => {
            it('should log tool error', () => {
                const mcpLogger = createMcpLogger('test_tool');
                const error = new Error('Tool failed');

                mcpLog.toolError(mcpLogger, error);

                expect(logger.error).toHaveBeenCalledWith(
                    '[MCP:test_tool] Tool execution failed',
                    {
                        toolName: 'test_tool',
                        error: {
                            message: 'Tool failed',
                            stack: error.stack,
                            name: 'Error'
                        }
                    }
                );
            });
        });

        describe('nodeOperation', () => {
            it('should create child logger for node operations', () => {
                const mcpLogger = createMcpLogger('test_tool');
                const nodeLogger = mcpLog.nodeOperation(mcpLogger, 'create', 'node-123', 'test-workflow');

                nodeLogger.info('Node operation test');

                expect(logger.info).toHaveBeenCalledWith(
                    '[MCP:test_tool] Node operation test',
                    {
                        toolName: 'test_tool',
                        operation: 'create',
                        nodeId: 'node-123',
                        workflowName: 'test-workflow'
                    }
                );
            });
        });

        describe('workflowOperation', () => {
            it('should create child logger for workflow operations', () => {
                const mcpLogger = createMcpLogger('test_tool');
                const workflowLogger = mcpLog.workflowOperation(mcpLogger, 'validate', 'test-workflow');

                workflowLogger.debug('Workflow operation test');

                expect(logger.debug).toHaveBeenCalledWith(
                    '[MCP:test_tool] Workflow operation test',
                    {
                        toolName: 'test_tool',
                        operation: 'validate',
                        workflowName: 'test-workflow'
                    }
                );
            });
        });
    });

    describe('Context handling', () => {
        it('should handle undefined/null context values gracefully', () => {
            const mcpLogger = new McpLogger({
                toolName: 'test_tool',
                userId: null,
                workflowName: undefined,
                nodeId: ''
            });

            mcpLogger.info('Null context test');

            expect(logger.info).toHaveBeenCalledWith(
                '[MCP:test_tool] Null context test',
                {
                    toolName: 'test_tool',
                    userId: null,
                    workflowName: undefined,
                    nodeId: ''
                }
            );
        });

        it('should handle complex nested data structures', () => {
            const mcpLogger = createMcpLogger('test_tool');
            const complexData = {
                nested: {
                    object: {
                        with: ['arrays', 'and', 'values']
                    }
                },
                numbers: 123,
                booleans: true
            };

            mcpLogger.debug('Complex data test', complexData);

            expect(logger.debug).toHaveBeenCalledWith(
                '[MCP:test_tool] Complex data test',
                {
                    toolName: 'test_tool',
                    data: complexData
                }
            );
        });
    });
});
