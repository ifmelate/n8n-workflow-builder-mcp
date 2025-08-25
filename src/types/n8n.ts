// N8N and workflow type definitions extracted from index.ts

export interface WorkflowNode {
    id: string;
    type: string;
    position: { x: number; y: number };
    parameters: Record<string, any>;
}

export interface WorkflowConnection {
    sourceNodeId: string;
    targetNodeId: string;
}

export interface Workflow {
    id: string;
    name: string;
    description: string;
    created: string;
    nodes: WorkflowNode[];
    connections: WorkflowConnection[];
}

export interface N8nWorkflowNode {
    parameters: Record<string, any>;
    type: string;
    typeVersion: number;
    position: [number, number];
    id: string;
    name: string;
    webhookId?: string;
}

export interface N8nConnectionDetail {
    node: string;
    type: string;
    index: number;
}

export interface N8nConnections {
    [sourceNodeName: string]: {
        [outputType: string]: N8nConnectionDetail[][];
    };
}

export interface N8nWorkflowSettings {
    executionOrder: "v1";
}

export interface N8nWorkflowMeta {
    instanceId: string;
}

export interface N8nWorkflow {
    name: string;
    nodes: N8nWorkflowNode[];
    pinData: Record<string, any>;
    connections: N8nConnections;
    active: boolean;
    settings: N8nWorkflowSettings;
    versionId: string;
    meta?: N8nWorkflowMeta;
    id: string;
    tags: string[];
}


