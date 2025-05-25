/**
 * MCP Test Utilities
 * Provides mock filesystem and other utilities for testing
 */

let mockFs;

/**
 * Setup mock filesystem for testing
 * @returns {Promise<void>}
 */
const setupMockFs = () => {
    mockFs = {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        mkdir: jest.fn().mockResolvedValue(),
        access: jest.fn().mockResolvedValue(),
        readdir: jest.fn(),
        unlink: jest.fn()
    };
    return Promise.resolve();
};

/**
 * Get the mock filesystem instance
 * @returns {Object} Mock filesystem object
 */
const getMockFs = () => mockFs;

/**
 * Reset all mock filesystem function calls
 */
const resetMockFs = () => {
    if (mockFs) {
        Object.keys(mockFs).forEach(key => {
            if (mockFs[key] && typeof mockFs[key].mockClear === 'function') {
                mockFs[key].mockClear();
            }
        });
    }
};

/**
 * Restore real filesystem (Jest cleanup is automatic)
 * @returns {Promise<void>}
 */
const restoreFs = () => {
    // Jest cleanup is automatic
    return Promise.resolve();
};

/**
 * Create a mock workflow object
 * @param {Object} options - Workflow options
 * @returns {Object} Mock workflow
 */
const createMockWorkflow = (options = {}) => {
    return {
        name: options.name || "TestWorkflow",
        nodes: options.nodes || [],
        connections: options.connections || {},
        active: options.active || false,
        pinData: options.pinData || {},
        settings: options.settings || { executionOrder: "v1" },
        versionId: options.versionId || "test-version-id",
        id: options.id || "test-workflow-id",
        tags: options.tags || []
    };
};

/**
 * Create a mock node object
 * @param {Object} options - Node options
 * @returns {Object} Mock node
 */
const createMockNode = (options = {}) => {
    return {
        id: options.id || `node-${Date.now()}`,
        name: options.name || "Test Node",
        type: options.type || "n8n-nodes-base.test",
        typeVersion: options.typeVersion || 1.0,
        position: options.position || [240, 300],
        parameters: options.parameters || {}
    };
};

module.exports = {
    setupMockFs,
    restoreFs,
    resetMockFs,
    getMockFs,
    createMockWorkflow,
    createMockNode
}; 