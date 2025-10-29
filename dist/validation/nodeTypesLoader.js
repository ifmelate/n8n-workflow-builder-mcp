"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadNodeTypesFromDir = loadNodeTypesFromDir;
exports.loadNodeTypesForCurrentVersion = loadNodeTypesForCurrentVersion;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const nodesDb_1 = require("../utils/nodesDb");
const workflowValidator_1 = require("./workflowValidator");
async function loadNodeTypesFromDir(dir) {
    const reg = new workflowValidator_1.SimpleNodeTypes();
    try {
        const files = await promises_1.default.readdir(dir);
        for (const f of files) {
            if (!f.endsWith('.json'))
                continue;
            try {
                const raw = await promises_1.default.readFile(path_1.default.join(dir, f), 'utf8');
                const def = JSON.parse(raw);
                if (!def?.nodeType || !def?.properties)
                    continue;
                const rawVersion = def.version ?? 1;
                const normalizedVersion = Array.isArray(rawVersion)
                    ? rawVersion.map((v) => (typeof v === 'number' ? v : parseFloat(String(v)))).filter((n) => !Number.isNaN(n))
                    : (typeof rawVersion === 'number' ? rawVersion : parseFloat(String(rawVersion)));
                // Preserve additional metadata used by validation when available
                const description = { name: def.nodeType, properties: def.properties || [] };
                if (Array.isArray(def.credentialsConfig))
                    description.credentialsConfig = def.credentialsConfig;
                if (def.wiring)
                    description.wiring = def.wiring;
                reg.register(def.nodeType, normalizedVersion, description);
            }
            catch {
                // ignore bad file
            }
        }
    }
    catch {
        // directory missing or unreadable
    }
    return reg;
}
async function loadNodeTypesForCurrentVersion(workflowNodesRoot, version) {
    const root = workflowNodesRoot;
    // Always ensure the requested/best version is materialized from DB first.
    try {
        const preferred = version || undefined;
        await (0, nodesDb_1.materializeBestVersion)(preferred);
    }
    catch { }
    if (!version || version === 'latest') {
        return loadNodeTypesFromDir(root);
    }
    const versioned = path_1.default.join(root, version);
    try {
        const stat = await promises_1.default.stat(versioned);
        if (stat.isDirectory())
            return loadNodeTypesFromDir(versioned);
    }
    catch {
        // fall through
    }
    return loadNodeTypesFromDir(root);
}
