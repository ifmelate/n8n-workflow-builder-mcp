import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { ToolNames } from '../../utils/constants';
import { createSuccessResponse, createErrorResponse } from '../../utils/responses';
import { v4 as uuidv4 } from 'uuid';

type TemplateWorkflow = {
    nodes: Array<{
        id?: string;
        name: string;
        type: string;
        typeVersion?: number | string;
        parameters?: Record<string, any>;
        position?: number[];
    }>;
    connections?: Record<string, Record<string, Array<Array<{ node: string; type: string; index: number }>>>>;
    meta?: Record<string, any>;
};

export const toolName = ToolNames.list_template_examples;
export const description = "List node usage examples extracted from free templates. Filter by node_type or template_name.";

export const paramsSchema = z.object({
    node_type: z.string().optional().describe("Filter examples by full node type (e.g., '@n8n/n8n-nodes-langchain.agent')"),
    template_name: z.string().optional().describe("Filter by a specific template file name (e.g., 'rag_example.json')"),
    limit: z.number().int().positive().max(1000).optional().describe("Maximum number of examples to return"),
    cursor: z.string().optional().describe("Opaque cursor for pagination; pass back to get the next page")
});

export type Params = z.infer<typeof paramsSchema>;

export async function handler(params: Params, _extra: any) {
    const correlationId = uuidv4();
    try {
        const templatesDir = path.resolve(__dirname, '../../../free_templates');
        let files: string[] = [];
        try {
            files = (await fs.readdir(templatesDir)).filter(f => f.endsWith('.json'));
        } catch (e: any) {
            return createErrorResponse('free_templates directory not found', { correlationId });
        }

        if (params.template_name) {
            files = files.filter(f => f === params.template_name);
        }

        const examples: Array<any> = [];

        for (const file of files) {
            const fullPath = path.join(templatesDir, file);
            try {
                const raw = await fs.readFile(fullPath, 'utf8');
                const wf = JSON.parse(raw) as TemplateWorkflow;
                const nodes = Array.isArray(wf.nodes) ? wf.nodes : [];
                const connections = (wf.connections || {}) as TemplateWorkflow['connections'];

                // Build quick lookup for incoming edges by node name
                const incomingByNode: Record<string, Record<string, number>> = {};
                try {
                    for (const [srcName, byType] of Object.entries(connections || {})) {
                        for (const [ctype, groups] of Object.entries(byType || {})) {
                            for (const group of (groups || [])) {
                                for (const conn of (group || [])) {
                                    const dst = conn?.node;
                                    if (!dst) continue;
                                    incomingByNode[dst] = incomingByNode[dst] || {};
                                    incomingByNode[dst][ctype] = (incomingByNode[dst][ctype] || 0) + 1;
                                }
                            }
                        }
                    }
                } catch { /* best-effort only */ }

                for (const node of nodes) {
                    if (params.node_type && String(node.type) !== params.node_type) continue;

                    // Outgoing summary for this node
                    const outByType: Record<string, number> = {};
                    try {
                        const byType = (connections || {})[node.name] || {};
                        for (const [ctype, groups] of Object.entries(byType)) {
                            let count = 0;
                            for (const group of (groups || [])) count += Array.isArray(group) ? group.length : 0;
                            outByType[ctype] = count;
                        }
                    } catch { /* ignore */ }

                    // Parameter preview (up to 8 fields)
                    const parameterPreview: Record<string, any> = {};
                    try {
                        const keys = Object.keys(node.parameters || {}).slice(0, 8);
                        for (const k of keys) parameterPreview[k] = (node.parameters as any)[k];
                    } catch { /* ignore */ }

                    examples.push({
                        template: file,
                        node: {
                            id: node.id,
                            name: node.name,
                            type: node.type,
                            typeVersion: node.typeVersion,
                            parameterPreview
                        },
                        connections: {
                            outgoingByType: outByType,
                            incomingByType: incomingByNode[node.name] || {}
                        }
                    });
                }
            } catch { /* skip bad template */ }
        }

        // Pagination
        const startIndex = params?.cursor ? Number(params.cursor) || 0 : 0;
        const limit = params?.limit ?? examples.length;
        const page = examples.slice(startIndex, startIndex + limit);
        const nextIndex = startIndex + limit;
        const nextCursor = nextIndex < examples.length ? String(nextIndex) : null;

        // Aggregate per node_type when requested
        let examplesByNodeType: Record<string, number> | undefined;
        if (params.node_type) {
            examplesByNodeType = {};
            for (const ex of page) {
                const t = ex?.node?.type;
                if (!t) continue;
                examplesByNodeType[t] = (examplesByNodeType[t] || 0) + 1;
            }
        }

        return createSuccessResponse({
            total: examples.length,
            nextCursor,
            examples: page,
            examplesByNodeType
        }, { correlationId });
    } catch (error: any) {
        return createErrorResponse('Failed to list template examples: ' + error.message);
    }
}





