/**
 * Auto-fix tool: Connect Main Chain
 * Creates a minimal main path through AI workflow nodes
 */
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { N8nWorkflow, N8nWorkflowNode } from '../../types/n8n';
import { resolveWorkflowPath, tryDetectWorkspaceForName } from '../../utils/workspace';
import { ToolNames, ErrorCodes } from '../../utils/constants';
import { loadNodeTypesForCurrentVersion } from '../../validation/nodeTypesLoader';
import { getCurrentN8nVersion } from '../../nodes/versioning';
import { wireAiConnections, NodeConnectionTypes, saveWorkflow, WiringConnection } from '../../tools/wiringService';
import { createSuccessResponse, createErrorResponse, createUsageInfo } from '../../utils/responses';
import { v4 as uuidv4 } from 'uuid';

export const toolName = 'connect_main_chain';
export const description = "Build a minimal main path through AI workflow nodes (Trigger → Model → Memory → Embeddings → Doc Loader → Vector Store → Vector Tool → Agent)";

export const paramsSchema = z.object({
    workflow_name: z.string().describe("The name of the workflow to connect"),
    workflow_path: z.string().optional().describe("Optional direct path to the workflow file"),
    dry_run: z.boolean().optional().default(false).describe("If true, returns planned connections without making changes"),
    idempotency_key: z.string().optional().describe("Optional idempotency key to prevent duplicate operations")
});

export type Params = z.infer<typeof paramsSchema>;

export async function handler(params: Params, _extra: any) {
    const correlationId = uuidv4();
    console.error(`[${correlationId}] connect_main_chain called with:`, Object.keys(params));

    try {
        // Load workflow
        let filePath = resolveWorkflowPath(params.workflow_name, params.workflow_path);
        try {
            if (!params.workflow_path) {
                await fs.access(filePath).catch(async () => {
                    const detected = await tryDetectWorkspaceForName(params.workflow_name);
                    if (detected) filePath = detected;
                });
            }
        } catch { /* ignore detection errors */ }

        let workflow: N8nWorkflow;
        try {
            const data = await fs.readFile(filePath, 'utf8');
            workflow = JSON.parse(data) as N8nWorkflow;
        } catch (readError: any) {
            if (readError.code === 'ENOENT') {
                return createErrorResponse(
                    `Workflow with name ${params.workflow_name} not found`,
                    {
                        code: ErrorCodes.VALIDATION_ERROR,
                        correlationId,
                        retryable: false,
                        remediation: `Ensure workflow exists at ${filePath} or provide correct workflow_path`
                    }
                );
            }
            throw readError;
        }

        // Load node types for role detection
        const workflowNodesRootDir = path.resolve(__dirname, '../../../workflow_nodes');
        const nodeTypes = await loadNodeTypesForCurrentVersion(workflowNodesRootDir, getCurrentN8nVersion());

        // Helper to get node role
        const getNodeRole = (node: N8nWorkflowNode): string | undefined => {
            try {
                const nodeType = nodeTypes.getByNameAndVersion(node.type, (node as any).typeVersion);
                return (nodeType as any)?.description?.wiring?.role;
            } catch {
                return undefined;
            }
        };

        // Categorize nodes by their roles
        const nodesByRole: Record<string, N8nWorkflowNode[]> = {};
        const addNodeToRole = (node: N8nWorkflowNode, role: string) => {
            if (!nodesByRole[role]) nodesByRole[role] = [];
            nodesByRole[role].push(node);
        };

        for (const node of workflow.nodes) {
            if ((node as any).disabled === true) continue;

            const role = getNodeRole(node);
            if (role) {
                addNodeToRole(node, role);
                continue;
            }

            // Fallback: detect by type name patterns
            const typeLower = String(node.type || '').toLowerCase();
            if (typeLower.includes('trigger')) {
                addNodeToRole(node, 'trigger');
            } else if (typeLower.includes('agent')) {
                addNodeToRole(node, 'agent');
            } else if (typeLower.includes('lmchat') || typeLower.includes('openai')) {
                addNodeToRole(node, 'model');
            } else if (typeLower.includes('memory') || typeLower.includes('buffer')) {
                addNodeToRole(node, 'memory');
            } else if (typeLower.includes('embedding')) {
                addNodeToRole(node, 'embeddings');
            } else if (typeLower.includes('vectorstore')) {
                addNodeToRole(node, 'vectorStore');
            } else if (typeLower.includes('documentloader')) {
                addNodeToRole(node, 'documentLoader');
            } else if (typeLower.includes('toolvectorstore')) {
                addNodeToRole(node, 'vectorTool');
            }
        }

        // Define the ideal main chain order
        const chainOrder = [
            'trigger',
            'model',
            'memory',
            'embeddings',
            'documentLoader',
            'vectorStore',
            'vectorTool',
            'agent'
        ];

        // Pick the first available node for each role
        const chainNodes: Array<{ role: string; node: N8nWorkflowNode | null }> = [];
        for (const role of chainOrder) {
            const candidates = nodesByRole[role] || [];
            chainNodes.push({
                role,
                node: candidates.length > 0 ? candidates[0] : null
            });
        }

        // Build main connections between consecutive nodes that exist
        const connections: WiringConnection[] = [];
        const addedConnections: string[] = [];

        for (let i = 0; i < chainNodes.length - 1; i++) {
            const current = chainNodes[i];
            const next = chainNodes[i + 1];

            if (!current.node || !next.node) continue;

            // Skip if this connection would be redundant with AI connections
            const isAiConnection = (current.role === 'model' && next.role === 'agent') ||
                (current.role === 'memory' && next.role === 'agent') ||
                (current.role === 'vectorTool' && next.role === 'agent');

            if (isAiConnection) {
                console.log(`[${correlationId}] Skipping AI connection ${current.role} → ${next.role} (handled by AI wiring)`);
                continue;
            }

            const connectionKey = `${current.node.id}→${next.node.id}`;
            if (addedConnections.includes(connectionKey)) continue;

            connections.push({
                fromNode: current.node,
                fromOutput: NodeConnectionTypes.MAIN,
                toNode: next.node,
                toInput: NodeConnectionTypes.MAIN
            });

            addedConnections.push(connectionKey);
            console.log(`[${correlationId}] Planned main connection: ${current.role}(${current.node.name}) → ${next.role}(${next.node.name})`);
        }

        if (connections.length === 0) {
            return createSuccessResponse({
                message: "No main chain connections needed",
                chainAnalysis: chainNodes.map(cn => ({
                    role: cn.role,
                    node: cn.node ? {
                        id: cn.node.id,
                        name: cn.node.name,
                        type: cn.node.type
                    } : null
                }))
            }, {
                correlationId,
                version: getCurrentN8nVersion() || undefined
            });
        }

        // Execute connections
        const wiringResult = await wireAiConnections(workflow, connections, {
            correlationId,
            idempotencyKey: params.idempotency_key,
            dryRun: params.dry_run
        });

        if (!wiringResult.success) {
            return createErrorResponse(
                "Failed to create main chain connections",
                {
                    code: ErrorCodes.TOOL_EXECUTION_ERROR,
                    correlationId,
                    retryable: true,
                    partial: wiringResult.connectionsCreated > 0,
                    details: {
                        connectionsCreated: wiringResult.connectionsCreated,
                        connectionsSkipped: wiringResult.connectionsSkipped,
                        errors: wiringResult.errors
                    }
                }
            );
        }

        // Save workflow if not dry run
        if (!params.dry_run) {
            const saveResult = await saveWorkflow(workflow, filePath, correlationId);
            if (!saveResult.success) {
                return createErrorResponse(
                    saveResult.error || "Failed to save workflow",
                    {
                        code: ErrorCodes.TOOL_EXECUTION_ERROR,
                        correlationId,
                        retryable: true,
                        partial: true,
                        remediation: "Main chain connections were created but not saved. Try saving manually or retry."
                    }
                );
            }
        }

        const responseData = {
            workflowName: params.workflow_name,
            workflowPath: filePath,
            mainChain: chainNodes
                .filter(cn => cn.node)
                .map(cn => ({
                    role: cn.role,
                    nodeId: cn.node!.id,
                    nodeName: cn.node!.name,
                    nodeType: cn.node!.type
                })),
            wiringResult: {
                connectionsCreated: wiringResult.connectionsCreated,
                connectionsSkipped: wiringResult.connectionsSkipped,
                connections: wiringResult.connections
            }
        };

        const changes = wiringResult.connections.map(conn => ({
            type: conn.status as 'created' | 'skipped',
            target: `${conn.from} → ${conn.to}`,
            details: {
                fromOutput: conn.fromOutput,
                toInput: conn.toInput
            }
        }));

        const usage = createUsageInfo({
            connectionsCreated: wiringResult.connectionsCreated,
            connectionsSkipped: wiringResult.connectionsSkipped
        });

        return createSuccessResponse(responseData, {
            correlationId,
            changes,
            usage,
            version: getCurrentN8nVersion() || undefined
        });

    } catch (error: any) {
        console.error(`[${correlationId}] Failed to connect main chain:`, error);
        return createErrorResponse(
            `Failed to connect main chain: ${error.message}`,
            {
                code: ErrorCodes.INTERNAL_SERVER_ERROR,
                correlationId,
                retryable: true,
                remediation: "Check workflow file and node definitions, then retry"
            }
        );
    }
}
