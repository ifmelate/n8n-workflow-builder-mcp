// Self-contained validator for n8n workflow JSON, adapted for inclusion in src

export type NodeConnectionType = string;

export interface IConnection {
    node: string;
    type: NodeConnectionType;
    index: number;
}

export type IConnections = Record<string, Record<string, Array<Array<IConnection | undefined> | undefined>>>;

export interface INodeParameters {
    [key: string]: unknown;
}

export interface INode {
    id?: string;
    name: string;
    type: string;
    typeVersion?: number;
    position?: [number, number];
    parameters: INodeParameters;
    disabled?: boolean;
    credentials?: Record<string, unknown>;
}

export interface IWorkflowSettings {
    timezone?: string;
    [key: string]: unknown;
}

export interface INodePropertyDescription {
    name: string;
    displayName?: string;
    type?: string;
    default?: unknown;
    required?: boolean;
    displayOptions?: unknown;
    options?: Array<{ name: string; value: unknown }>;
    typeOptions?: Record<string, unknown>;
}

export interface INodeTypeDescription {
    name?: string;
    properties: INodePropertyDescription[];
    credentialsConfig?: Array<{ name: string; required?: boolean }>;
    wiring?: { requires?: string[] };
}

export interface INodeType {
    description: INodeTypeDescription;
}

export interface INodeTypes {
    getByNameAndVersion(name: string, version?: number): INodeType | undefined;
}

export type ValidationError = {
    code: string;
    message: string;
    nodeName?: string;
    details?: unknown;
};

export type ValidationWarning = {
    code: string;
    message: string;
    nodeName?: string;
    details?: unknown;
};

export type ValidationReport = {
    ok: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    normalized: {
        nodes: Record<string, INode>;
        connectionsBySource: IConnections;
        connectionsByDestination: IConnections;
    };
    startNode?: string;
    nodeIssues?: Record<string, NodeValidationIssue[]>;
};

export type ImportedWorkflowJson = {
    id?: string;
    name?: string;
    nodes?: INode[];
    connections?: IConnections;
    settings?: IWorkflowSettings;
    pinData?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertBasicShape(input: unknown): asserts input is ImportedWorkflowJson {
    if (!isRecord(input)) throw new Error('Workflow must be an object');
    if (!Array.isArray((input as any).nodes)) throw new Error('Workflow.nodes must be an array');
    if (!isRecord((input as any).connections)) throw new Error('Workflow.connections must be an object');
}

function mapConnectionsByDestination(source: IConnections): IConnections {
    const dest: IConnections = {};
    for (const [src, byType] of Object.entries(source)) {
        for (const [type, groups] of Object.entries(byType)) {
            (groups || []).forEach((group, inputIndex) => {
                (group || []).forEach((conn) => {
                    if (!conn) return;
                    const target = conn.node;
                    dest[target] = dest[target] || {};
                    dest[target][type] = dest[target][type] || [];
                    const arr = dest[target][type]!;
                    while (arr.length <= conn.index) arr.push([]);
                    arr[conn.index] = arr[conn.index] || [];
                    arr[conn.index]!.push({ node: src, type: type as NodeConnectionType, index: inputIndex });
                });
            });
        }
    }
    return dest;
}

function applyDefaultParameters(node: INode, nodeType: INodeType) {
    const defaults = nodeType.description?.properties || [];
    for (const prop of defaults) {
        const name = prop.name;
        // Avoid auto-filling placeholder defaults for required resource locators
        // These defaults are typically UI placeholders and should be treated as missing
        const isRequiredResourceLocator = prop.required === true && String(prop.type || '').toLowerCase() === 'resourcelocator';
        if (isRequiredResourceLocator) continue;

        if (!(name in (node.parameters || {})) && Object.prototype.hasOwnProperty.call(prop, 'default')) {
            node.parameters[name] = prop.default as any;
        }
    }
}

// Helpers for node-level validation
type DisplayOptions = { show?: Record<string, unknown>; hide?: Record<string, unknown> };

function isEmpty(val: unknown): boolean {
    if (val === undefined || val === null) return true;
    if (typeof val === 'string') return val.trim() === '';
    if (Array.isArray(val)) return val.length === 0;
    if (typeof val === 'object') return Object.keys(val as object).length === 0;
    return false;
}

function evaluateDisplayOptions(displayOptions: unknown, params: INodeParameters): boolean {
    const opts = (displayOptions || {}) as DisplayOptions;
    const toArray = (v: unknown) => (Array.isArray(v) ? v : [v]);

    // show: all keys must match at least one provided value
    if (opts.show) {
        for (const [key, expected] of Object.entries(opts.show)) {
            const val = (params as any)[key];
            const list = toArray(expected).map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : x));
            const match = toArray(val).some((v) => list.includes(typeof v === 'object' && v !== null ? JSON.stringify(v) : v));
            if (!match) return false;
        }
    }

    // hide: if any key matches, the field is hidden
    if (opts.hide) {
        for (const [key, expected] of Object.entries(opts.hide)) {
            const val = (params as any)[key];
            const list = toArray(expected).map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : x));
            const match = toArray(val).some((v) => list.includes(typeof v === 'object' && v !== null ? JSON.stringify(v) : v));
            if (match) return false;
        }
    }

    return true;
}

export type NodeValidationIssue = {
    code: string;
    message: string;
    property?: string;
};

export function validateNodeAgainstDefinition(node: INode, nodeType: INodeType): { ok: boolean; issues: NodeValidationIssue[] } {
    const issues: NodeValidationIssue[] = [];
    const properties = nodeType.description?.properties || [];

    // required parameters (respect simple displayOptions)
    for (const prop of properties) {
        if (!prop.required) continue;
        const visible = evaluateDisplayOptions(prop.displayOptions, node.parameters || {});
        if (!visible) continue;
        const value = (node.parameters || {})[prop.name];
        if (isEmpty(value)) {
            issues.push({ code: 'missing_parameter', message: `Parameter "${prop.displayName || prop.name}" is required.`, property: prop.name });
        }
    }

    // fixedCollection option validation
    for (const prop of properties) {
        if (prop.type !== 'fixedCollection') continue;
        const visible = evaluateDisplayOptions(prop.displayOptions, node.parameters || {});
        if (!visible) continue;
        const value = (node.parameters || {})[prop.name] as Record<string, unknown> | undefined;
        if (value === undefined) continue;

        const allowed = new Set((prop.options || []).map((o) => o.name));
        const multiple = !!(prop.typeOptions && (prop.typeOptions as any).multipleValues);

        if (multiple) {
            if (!isRecord(value)) {
                issues.push({ code: 'invalid_fixed_collection_shape', message: `"${prop.displayName || prop.name}" must be an object with arrays per option.`, property: prop.name });
            } else {
                for (const k of Object.keys(value)) {
                    if (!allowed.has(k)) {
                        issues.push({ code: 'unknown_fixed_collection_option', message: `Unknown option "${k}" in "${prop.displayName || prop.name}"`, property: prop.name });
                        continue;
                    }
                    const arr = (value as any)[k];
                    if (!Array.isArray(arr)) {
                        issues.push({ code: 'invalid_fixed_collection_shape', message: `Option "${k}" in "${prop.displayName || prop.name}" must be an array.`, property: prop.name });
                    }
                }
                const min = (prop.typeOptions as any)?.minRequiredFields;
                const max = (prop.typeOptions as any)?.maxAllowedFields;
                const total = Object.keys(value).reduce((sum, k) => sum + (Array.isArray((value as any)[k]) ? (value as any)[k].length : 0), 0);
                if (typeof min === 'number' && total < min) {
                    issues.push({ code: 'fixed_collection_min_fields', message: `At least ${min} ${min === 1 ? 'field is' : 'fields are'} required.`, property: prop.name });
                }
                if (typeof max === 'number' && total > max) {
                    issues.push({ code: 'fixed_collection_max_fields', message: `At most ${max} ${max === 1 ? 'field is' : 'fields are'} allowed.`, property: prop.name });
                }
            }
        } else {
            if (!isRecord(value)) {
                issues.push({ code: 'invalid_fixed_collection_shape', message: `"${prop.displayName || prop.name}" must be an object with exactly one option.`, property: prop.name });
            } else {
                const keys = Object.keys(value);
                for (const k of keys) {
                    if (!allowed.has(k)) {
                        issues.push({ code: 'unknown_fixed_collection_option', message: `Unknown option "${k}" in "${prop.displayName || prop.name}"`, property: prop.name });
                    }
                }
                if (keys.length > 1) {
                    issues.push({ code: 'fixed_collection_multiple_selected', message: `Only one option can be selected in "${prop.displayName || prop.name}".`, property: prop.name });
                }
                const min = (prop.typeOptions as any)?.minRequiredFields;
                const max = (prop.typeOptions as any)?.maxAllowedFields;
                const total = keys.length;
                if (typeof min === 'number' && total < min) {
                    issues.push({ code: 'fixed_collection_min_fields', message: `At least ${min} ${min === 1 ? 'field is' : 'fields are'} required.`, property: prop.name });
                }
                if (typeof max === 'number' && total > max) {
                    issues.push({ code: 'fixed_collection_max_fields', message: `At most ${max} ${max === 1 ? 'field is' : 'fields are'} allowed.`, property: prop.name });
                }
            }
        }
    }

    // credentials required via credentialsConfig
    const anyDesc = nodeType.description as unknown as { credentialsConfig?: Array<{ name: string; required?: boolean }> };
    if (Array.isArray(anyDesc?.credentialsConfig)) {
        for (const cred of anyDesc.credentialsConfig) {
            if (cred.required) {
                const has = !!(node.credentials && Object.prototype.hasOwnProperty.call(node.credentials, cred.name));
                if (!has) issues.push({ code: 'missing_credentials', message: `Credentials for ${cred.name} are not set.` });
            }
        }
    }

    // Heuristic: some community node definitions omit credentialsConfig but still require credentials
    // Ensure common AI providers are flagged when credentials are clearly expected
    const typeNameLower = String(node.type || '').toLowerCase();
    const hasAnyCredentials = !!(node.credentials && Object.keys(node.credentials).length > 0);
    if (!hasAnyCredentials) {
        // OpenRouter chat model typically requires an API key even if credentialsConfig isn't declared
        if (typeNameLower.includes('lmchatopenrouter')) {
            issues.push({ code: 'missing_credentials', message: 'Credentials are required for OpenRouter model but are not set.' });
        }
    }

    return { ok: issues.length === 0, issues };
}

export function validateAndNormalizeWorkflow(
    raw: unknown,
    nodeTypes: INodeTypes,
): ValidationReport {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
        assertBasicShape(raw);
    } catch (e) {
        return {
            ok: false,
            errors: [
                {
                    code: 'invalid_shape',
                    message: e instanceof Error ? e.message : 'Invalid workflow JSON',
                },
            ],
            warnings,
            normalized: {
                nodes: {},
                connectionsBySource: {},
                connectionsByDestination: {},
            },
        };
    }

    const json = raw as ImportedWorkflowJson;

    const nodesByName: Record<string, INode> = {};
    const nodeIssues: Record<string, NodeValidationIssue[]> = {};
    for (const node of (json.nodes as INode[]) ?? []) {
        nodesByName[node.name] = { ...node, parameters: { ...(node.parameters || {}) } };
        const nodeType = nodeTypes.getByNameAndVersion(node.type, node.typeVersion);
        if (!nodeType) {
            errors.push({
                code: 'unknown_node_type',
                message: `Unknown node type ${node.type}@${node.typeVersion} for node "${node.name}"`,
                nodeName: node.name,
                details: { type: node.type, version: node.typeVersion },
            });
        } else {
            applyDefaultParameters(nodesByName[node.name], nodeType);
            const v = validateNodeAgainstDefinition(nodesByName[node.name], nodeType);
            if (!v.ok) nodeIssues[node.name] = v.issues;
        }
    }

    const connectionsBySource: IConnections = (json.connections as IConnections) ?? {};
    const connectionsByDestination: IConnections = mapConnectionsByDestination(connectionsBySource);

    for (const [sourceName, byType] of Object.entries(connectionsBySource)) {
        if (!nodesByName[sourceName]) {
            errors.push({
                code: 'unknown_source_node',
                message: `Connection from unknown source node "${sourceName}"`,
                nodeName: sourceName,
            });
            continue;
        }
        for (const groups of Object.values(byType)) {
            (groups || []).forEach((group) => {
                (group || []).forEach((conn) => {
                    if (!conn) return;
                    if (!nodesByName[conn.node]) {
                        errors.push({
                            code: 'unknown_target_node',
                            message: `Connection to unknown target node "${conn.node}" from "${sourceName}"`,
                            nodeName: conn.node,
                        });
                    }
                });
            });
        }
    }

    if (isRecord(json.pinData)) {
        for (const nodeName of Object.keys(json.pinData)) {
            if (!nodesByName[nodeName]) {
                warnings.push({
                    code: 'pin_for_unknown_node',
                    message: `pinData references unknown node "${nodeName}"`,
                    nodeName,
                });
            }
        }
    }

    // Warn/Error about unconnected/dangling nodes and missing AI ports
    const countConnections = (byType: Record<string, Array<Array<IConnection | undefined> | undefined>> | undefined): number => {
        if (!byType) return 0;
        let count = 0;
        for (const groups of Object.values(byType)) {
            (groups || []).forEach((group) => {
                (group || []).forEach((conn) => { if (conn) count++; });
            });
        }
        return count;
    };
    const countMainConnections = (byType: Record<string, Array<Array<IConnection | undefined> | undefined>> | undefined): number => {
        if (!byType) return 0;
        let count = 0;
        const groups = (byType as any).main || [];
        (groups || []).forEach((group: Array<IConnection | undefined> | undefined) => {
            (group || []).forEach((conn) => { if (conn) count++; });
        });
        return count;
    };

    for (const [nodeName, node] of Object.entries(nodesByName)) {
        const outgoingCount = countConnections(connectionsBySource[nodeName]);
        const incomingCount = countConnections(connectionsByDestination[nodeName]);
        if (node.disabled !== true) {
            if (outgoingCount === 0 && incomingCount === 0) {
                warnings.push({
                    code: 'unconnected_node',
                    message: `Node "${nodeName}" (ID: ${node.id || 'unknown'}) has no incoming or outgoing connections`,
                    nodeName,
                    details: { type: node.type, nodeId: node.id }
                });
            }
        }

        const typeLower = String(node.type || '').toLowerCase();
        const isAiLike = typeLower.includes('langchain') || typeLower.includes('ai') || typeLower.includes('openai') || typeLower.includes('llm') || typeLower.includes('agent');
        const isTrigger = typeLower.includes('chattrigger');
        if (isAiLike) {
            const srcTypes = Object.keys(connectionsBySource[nodeName] || {});
            const dstTypes = Object.keys(connectionsByDestination[nodeName] || {});
            const hasAiPort = srcTypes.some(t => t.startsWith('ai_')) || dstTypes.some(t => t.startsWith('ai_'));
            if (!hasAiPort && !isTrigger) {
                warnings.push({
                    code: 'ai_node_without_ai_ports',
                    message: `AI-related node "${nodeName}" (ID: ${node.id || 'unknown'}) is not wired via any ai_* ports (ai_languageModel, ai_tool, ai_memory)`,
                    nodeName,
                    details: { type: node.type, nodeId: node.id }
                });
            }
        }

        // Note: invalid start node checks are enforced at tool-level to avoid over-warning base validator
    }

    // Warn about node definitions that require specific input roles (from wiring.requires)
    for (const [nodeName, node] of Object.entries(nodesByName)) {
        const nodeType = nodeTypes.getByNameAndVersion(node.type, node.typeVersion);
        const requiredInputs = nodeType?.description?.wiring?.requires || [];
        if (requiredInputs.length > 0) {
            const normalizePort = (s: string) => String(s).toLowerCase().replace(/_/g, '');
            const incomingTypes = Object.keys(connectionsByDestination[nodeName] || {}).map(k => normalizePort(k));
            for (const req of requiredInputs) {
                const hasReq = incomingTypes.includes(normalizePort(String(req)));
                if (!hasReq) {
                    warnings.push({
                        code: 'missing_required_input',
                        message: `Node "${nodeName}" (ID: ${node.id || 'unknown'}) has no node connected to required input "${req}"`,
                        nodeName,
                        details: { input: req, nodeId: node.id }
                    });
                }
            }
        }
    }

    let startNode: string | undefined;
    const incomingMain = new Set<string>(Object.keys(connectionsByDestination).filter((k) => (connectionsByDestination[k] || {}).hasOwnProperty('main')));

    // Prefer explicit trigger nodes as start when present
    const triggerCandidates = Object.keys(nodesByName)
        .filter((n) => String((nodesByName[n]?.type || '')).toLowerCase().includes('trigger') && nodesByName[n].disabled !== true);
    if (triggerCandidates.length > 0) {
        // Prefer chatTrigger if multiple
        const chatTrigger = triggerCandidates.find((n) => String((nodesByName[n]?.type || '')).toLowerCase().includes('chattrigger'));
        startNode = chatTrigger || triggerCandidates[0];
    }

    if (!startNode) {
        // Fallback: pick a head to continue connectivity analysis
        for (const name of Object.keys(nodesByName)) {
            if (!incomingMain.has(name) && nodesByName[name].disabled !== true) {
                startNode = name;
                break;
            }
        }
    }
    if (!startNode) {
        startNode = Object.keys(nodesByName)[0];
    }
    if (!startNode) {
        warnings.push({ code: 'no_start_node', message: 'No start node inferred for workflow' });
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        normalized: {
            nodes: nodesByName,
            connectionsBySource,
            connectionsByDestination,
        },
        startNode,
        nodeIssues: Object.keys(nodeIssues).length ? nodeIssues : undefined,
    };
}

export class SimpleNodeTypes implements INodeTypes {
    private readonly registry: Map<string, INodeType> = new Map();

    register(name: string, version: number | number[] | undefined, description: INodeTypeDescription) {
        const versions = Array.isArray(version) ? version : version !== undefined ? [version] : [1];
        const nodeType: INodeType = { description };
        for (const v of versions) {
            this.registry.set(`${name}@${v}`, nodeType);
        }
    }

    getByNameAndVersion(name: string, version?: number): INodeType | undefined {
        if (version !== undefined) return this.registry.get(`${name}@${version}`);
        const candidates = [...this.registry.keys()]
            .filter((k) => k.startsWith(`${name}@`))
            .sort()
            .reverse();
        const key = candidates[0];
        return key ? this.registry.get(key) : undefined;
    }
}


