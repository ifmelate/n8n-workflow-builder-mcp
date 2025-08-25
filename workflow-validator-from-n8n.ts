// Self-contained validator for n8n workflow JSON, with no imports from the n8n repo

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
    // optional map of credential name -> credential payload/id
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
    if (!Array.isArray(input.nodes)) throw new Error('Workflow.nodes must be an array');
    if (!isRecord(input.connections)) throw new Error('Workflow.connections must be an object');
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
        if (!(name in (node.parameters || {})) && Object.prototype.hasOwnProperty.call(prop, 'default')) {
            node.parameters[name] = prop.default;
        }
    }
}

function isEmpty(val: unknown): boolean {
    if (val === undefined || val === null) return true;
    if (typeof val === 'string') return val.trim() === '';
    if (Array.isArray(val)) return val.length === 0;
    if (typeof val === 'object') return Object.keys(val as object).length === 0;
    return false;
}

type DisplayOptions = { show?: Record<string, unknown>; hide?: Record<string, unknown> };

function evaluateDisplayOptions(displayOptions: unknown, params: INodeParameters): boolean {
    const opts = (displayOptions || {}) as DisplayOptions;
    const toArray = (v: unknown) => (Array.isArray(v) ? v : [v]);

    // show: all keys must match at least one of provided values
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

    // fixedCollection option validation (prevents "Could not find property option")
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
                // optional min/max fields count
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

    // credentials required
    // We look into a conventional credential requirement: nodeType.description may have no credentials in scraped JSON.
    // If your node_definitions contain credentialsConfig: [{ name, required }], prefer that.
    const anyDesc = nodeType.description as unknown as { credentialsConfig?: Array<{ name: string; required?: boolean }> };
    if (Array.isArray(anyDesc?.credentialsConfig)) {
        for (const cred of anyDesc.credentialsConfig) {
            if (cred.required) {
                const has = !!(node.credentials && Object.prototype.hasOwnProperty.call(node.credentials, cred.name));
                if (!has) issues.push({ code: 'missing_credentials', message: `Credentials for ${cred.name} are not set.` });
            }
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

    // Build nodes map and apply defaults where possible
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

    // Validate connections reference existing nodes
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

    // Validate pinData node references
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

    // Infer a simple start node: first node with no incoming 'main' connection
    let startNode: string | undefined;
    const incomingMain = new Set<string>(Object.keys(connectionsByDestination).filter((k) => (connectionsByDestination[k] || {}).hasOwnProperty('main')));
    for (const name of Object.keys(nodesByName)) {
        if (!incomingMain.has(name) && nodesByName[name].disabled !== true) {
            startNode = name;
            break;
        }
    }
    if (!startNode) {
        // fallback to first node if any
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

// Convenience: minimal in-memory node types registry for tests or external callers
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

// Example runner (optional):
//  ts-node tools/workflowValidator.ts /path/to/workflow.json
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const module: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const file = process.argv[2];
    if (!file) {
        console.error('Usage: ts-node tools/workflowValidator.ts <workflow.json>');
        process.exit(2);
    }
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as ImportedWorkflowJson;
    const nodeTypes: INodeTypes = { getByNameAndVersion: () => undefined };
    const report = validateAndNormalizeWorkflow(json, nodeTypes);
    console.log(JSON.stringify({ ok: report.ok, errors: report.errors, warnings: report.warnings, startNode: report.startNode }, null, 2));
}


