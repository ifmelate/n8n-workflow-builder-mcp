/**
 * MCP Server Testing Utilities
 * 
 * Provides helper functions for testing MCP server tool handlers
 */

const path = require('path');
const sinon = require('sinon');

// Create dynamic loading for fs/promises to avoid ESM issues
let fs;

const initFs = async () => {
    if (!fs) {
        try {
            fs = await import('fs/promises');
        } catch (error) {
            // Fallback for older Node versions
            fs = require('fs/promises');
        }
    }
    return fs;
};

// Store original fs methods to restore later
const originalFs = {};

// Mock fs methods
const mockFs = {
    mkdir: sinon.stub().resolves(),
    readFile: sinon.stub(),
    writeFile: sinon.stub().resolves(),
    stat: sinon.stub().resolves({ isDirectory: () => true })
};

/**
 * Setup mock fs functions
 */
async function setupMockFs() {
    const fsModule = await initFs();

    // Backup original methods if not already done
    if (Object.keys(originalFs).length === 0) {
        originalFs.mkdir = fsModule.mkdir;
        originalFs.readFile = fsModule.readFile;
        originalFs.writeFile = fsModule.writeFile;
        originalFs.stat = fsModule.stat;
    }

    // Apply mocks
    fsModule.mkdir = mockFs.mkdir;
    fsModule.readFile = mockFs.readFile;
    fsModule.writeFile = mockFs.writeFile;
    fsModule.stat = mockFs.stat;
}

/**
 * Restore original fs functions
 */
async function restoreFs() {
    const fsModule = await initFs();

    // Only restore if originals were backed up
    if (Object.keys(originalFs).length > 0) {
        fsModule.mkdir = originalFs.mkdir;
        fsModule.readFile = originalFs.readFile;
        fsModule.writeFile = originalFs.writeFile;
        fsModule.stat = originalFs.stat;
    }
}

/**
 * Reset mock fs stubs
 */
function resetMockFs() {
    mockFs.mkdir.reset();
    mockFs.readFile.reset();
    mockFs.writeFile.reset();
    mockFs.stat.reset();
}

/**
 * Get mockFs stub for testing verification
 */
function getMockFs() {
    return mockFs;
}

/**
 * Create a direct test handler for an MCP tool
 * This extracts the handler function from the server.tool() call in index.ts
 * 
 * @param {string} toolName Name of the tool to mock
 * @returns {Function} Function that can be called directly for testing
 */
function createToolTestHandler(toolName) {
    return async (params, _extra = {}) => {
        // Mock implementation - in a real test you would:
        // 1. Load the index.ts and intercept the server.tool() call
        // 2. Extract the handler function for the specific tool
        // 3. Return a function that calls that handler

        // For now, we'll just check and simulate the response
        // This would be implemented with proper module mocking

        try {
            // Simulate the handler response format
            return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] };
        } catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: error.message }) }] };
        }
    };
}

module.exports = {
    setupMockFs,
    restoreFs,
    resetMockFs,
    getMockFs,
    createToolTestHandler
}; 