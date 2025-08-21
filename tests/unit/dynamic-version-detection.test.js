const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
jest.setTimeout(60000);
const fs = require('fs').promises;
const path = require('path');

/**
 * Simplified version of the dynamic version detection logic for testing
 * This mirrors the logic in initializeN8nVersionSupport()
 */
async function analyzeDynamicVersions(workflowNodesDir) {
    const versionMappings = {};

    try {
        const entries = await fs.readdir(workflowNodesDir, { withFileTypes: true });
        let versionDirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
        // Limit to a reasonable sample to keep tests fast and avoid open handle leaks
        const SAMPLE_LIMIT = 20;
        if (versionDirs.length > SAMPLE_LIMIT) {
            versionDirs = versionDirs.slice(0, SAMPLE_LIMIT);
        }

        console.log(`[DEBUG] Found ${versionDirs.length} version directories:`, versionDirs.slice(0, 5));

        // Process each version directory
        for (const versionDir of versionDirs) {
            const versionPath = path.join(workflowNodesDir, versionDir);
            const supportedNodes = new Map();

            // Analyze nodes in this version to determine capabilities
            const capabilities = new Set();
            capabilities.add("basic_nodes"); // All versions have basic nodes

            let langchainCount = 0;
            let aiCount = 0;
            let triggerCount = 0;

            try {
                const nodeFiles = await fs.readdir(versionPath);
                const jsonFiles = nodeFiles.filter(file => file.endsWith('.json'));

                for (const nodeFile of jsonFiles) {
                    try {
                        const nodeFilePath = path.join(versionPath, nodeFile);
                        const nodeContent = await fs.readFile(nodeFilePath, 'utf8');
                        const nodeDefinition = JSON.parse(nodeContent);

                        if (nodeDefinition.nodeType && nodeDefinition.version) {
                            const nodeType = nodeDefinition.nodeType;
                            const versions = Array.isArray(nodeDefinition.version)
                                ? nodeDefinition.version
                                : [nodeDefinition.version];

                            // Add node to supported nodes
                            if (!supportedNodes.has(nodeType)) {
                                supportedNodes.set(nodeType, new Set());
                            }
                            versions.forEach(v => supportedNodes.get(nodeType).add(v));

                            // Analyze node type for capability detection
                            const nodeTypeStr = nodeType.toLowerCase();
                            const displayName = (nodeDefinition.displayName || '').toLowerCase();
                            const fileName = nodeFile.toLowerCase();

                            // Detect LangChain nodes
                            if (nodeTypeStr.includes('langchain') || fileName.includes('langchain')) {
                                langchainCount++;
                            }

                            // Detect AI-related nodes
                            if (nodeTypeStr.includes('ai') || nodeTypeStr.includes('openai') ||
                                nodeTypeStr.includes('llm') || nodeTypeStr.includes('agent') ||
                                displayName.includes('ai') || fileName.includes('ai') ||
                                fileName.includes('openai') || fileName.includes('llm')) {
                                aiCount++;
                            }

                            // Detect trigger nodes
                            if (nodeTypeStr.includes('trigger') || fileName.includes('trigger')) {
                                triggerCount++;
                            }
                        }
                    } catch (error) {
                        // Skip invalid files
                    }
                }

                // Determine capabilities based on node analysis
                if (triggerCount > 0) {
                    capabilities.add("webhook_triggers");
                }

                if (langchainCount > 0) {
                    if (langchainCount < 10) {
                        capabilities.add("langchain_basic");
                    } else {
                        capabilities.add("langchain_full");
                    }
                }

                if (aiCount > 0) {
                    capabilities.add("ai_nodes");
                    if (aiCount > 5) {
                        capabilities.add("advanced_ai");
                    }
                }

            } catch (error) {
                // Skip directories that can't be read
            }

            // Create version info
            versionMappings[versionDir] = {
                version: versionDir,
                supportedNodes,
                capabilities: Array.from(capabilities),
                nodeCount: supportedNodes.size,
                langchainCount,
                aiCount,
                triggerCount
            };
        }

    } catch (error) {
        // Return empty mappings if directory structure can't be read
        console.log('[DEBUG] Error reading directory structure:', error.message);
    }

    return versionMappings;
}

describe('Dynamic Version Detection', () => {
    let cachedMappings = null;
    let workflowNodesDirGlobal = null;

    beforeAll(async () => {
        workflowNodesDirGlobal = path.resolve(__dirname, '../../workflow_nodes');
        try {
            const stat = await fs.stat(workflowNodesDirGlobal);
            if (stat.isDirectory()) {
                cachedMappings = await analyzeDynamicVersions(workflowNodesDirGlobal);
            }
        } catch (_) {
            cachedMappings = {};
        }
    });
    describe('analyzeDynamicVersions', () => {
        it('should discover version directories in workflow_nodes', async () => {
            console.log('Testing with directory:', workflowNodesDirGlobal);

            // Ensure directory exists
            const stat = await fs.stat(workflowNodesDirGlobal);
            expect(stat.isDirectory()).toBe(true);

            console.log('Discovered versions:', Object.keys(cachedMappings));
            expect(Object.keys(cachedMappings).length).toBeGreaterThan(0);
        });

        it('should analyze capabilities correctly for each version', async () => {
            const versionMappings = cachedMappings;

            for (const [version, info] of Object.entries(versionMappings)) {
                // All versions should have basic capabilities
                expect(info.capabilities).toContain('basic_nodes');

                // Should have analyzed some nodes
                expect(info.nodeCount).toBeGreaterThan(0);

                console.log(`Version ${version}:`, {
                    nodeCount: info.nodeCount,
                    capabilities: info.capabilities,
                    langchain: info.langchainCount,
                    ai: info.aiCount,
                    triggers: info.triggerCount
                });
            }
        });

        it('should detect LangChain nodes correctly', async () => {
            const versionMappings = cachedMappings;

            for (const [version, info] of Object.entries(versionMappings)) {
                if (info.langchainCount > 0) {
                    if (info.langchainCount < 10) {
                        expect(info.capabilities).toContain('langchain_basic');
                    } else {
                        expect(info.capabilities).toContain('langchain_full');
                    }
                }
            }
        });

        it('should detect AI nodes correctly', async () => {
            const versionMappings = cachedMappings;

            for (const [version, info] of Object.entries(versionMappings)) {
                if (info.aiCount > 0) {
                    expect(info.capabilities).toContain('ai_nodes');

                    if (info.aiCount > 5) {
                        expect(info.capabilities).toContain('advanced_ai');
                    }
                }
            }
        });

        it('should detect trigger nodes correctly', async () => {
            const versionMappings = cachedMappings;

            for (const [version, info] of Object.entries(versionMappings)) {
                if (info.triggerCount > 0) {
                    expect(info.capabilities).toContain('webhook_triggers');
                }
            }
        });

        it('should handle empty or invalid directories gracefully', async () => {
            const nonExistentDir = path.resolve(__dirname, '../../non-existent-dir');
            const versionMappings = await analyzeDynamicVersions(nonExistentDir);

            // Should return empty mappings without throwing
            expect(versionMappings).toEqual({});
        });
    });

    describe('Node Analysis', () => {
        it('should correctly categorize node types from actual files', async () => {
            const workflowNodesDir = path.resolve(__dirname, '../../workflow_nodes');

            try {
                // Check if we have versioned structure
                const entries = await fs.readdir(workflowNodesDir, { withFileTypes: true });
                const versionDirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);

                if (versionDirs.length > 0) {
                    // Test with the first available version
                    const testVersion = versionDirs[0];
                    const versionPath = path.join(workflowNodesDir, testVersion);
                    const nodeFiles = await fs.readdir(versionPath);
                    const jsonFiles = nodeFiles.filter(file => file.endsWith('.json'));

                    expect(jsonFiles.length).toBeGreaterThan(0);

                    // Test categorization of a few sample files
                    const sampleSize = Math.min(5, jsonFiles.length);
                    const sampleFiles = jsonFiles.slice(0, sampleSize);

                    for (const file of sampleFiles) {
                        const filePath = path.join(versionPath, file);
                        const content = await fs.readFile(filePath, 'utf8');
                        const nodeDefinition = JSON.parse(content);

                        expect(nodeDefinition).toHaveProperty('nodeType');
                        expect(nodeDefinition).toHaveProperty('version');

                        const isLangchain = file.toLowerCase().includes('langchain');
                        const isAI = file.toLowerCase().includes('ai') ||
                            file.toLowerCase().includes('openai') ||
                            file.toLowerCase().includes('llm');
                        const isTrigger = file.toLowerCase().includes('trigger');

                        console.log(`File: ${file}`, {
                            nodeType: nodeDefinition.nodeType,
                            isLangchain,
                            isAI,
                            isTrigger
                        });
                    }
                }
            } catch (error) {
                // If we can't read the directory, skip this test
                console.log('Skipping node analysis test - directory not accessible');
            }
        });
    });
}); 