"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentN8nVersion = getCurrentN8nVersion;
exports.getN8nVersionInfo = getN8nVersionInfo;
exports.getSupportedN8nVersions = getSupportedN8nVersions;
exports.initializeN8nVersionSupport = initializeN8nVersionSupport;
exports.detectN8nVersion = detectN8nVersion;
exports.setN8nVersion = setN8nVersion;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
let currentN8nVersion = null;
let n8nVersionInfo = null;
let supportedN8nVersions = new Map();
const N8N_VERSION_OVERRIDE = process.env.N8N_VERSION;
const N8N_API_URL = process.env.N8N_API_URL;
function getCurrentN8nVersion() {
    return currentN8nVersion;
}
function getN8nVersionInfo() {
    return n8nVersionInfo;
}
function getSupportedN8nVersions() {
    return supportedN8nVersions;
}
function compareSemver(a, b) {
    const normalize = (v) => v.replace(/^v/i, '');
    const pa = normalize(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = normalize(b).split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = pa[i] ?? 0;
        const nb = pb[i] ?? 0;
        if (na !== nb)
            return na - nb;
    }
    return 0;
}
async function initializeN8nVersionSupport() {
    // When compiled, this file lives in dist/nodes, so we must go two levels up
    // to reach the repository root and then into workflow_nodes
    const workflowNodesDir = path_1.default.resolve(__dirname, '../../workflow_nodes');
    const versionMappings = {};
    try {
        const entries = await promises_1.default.readdir(workflowNodesDir, { withFileTypes: true });
        const versionDirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
        for (const versionDir of versionDirs) {
            const versionPath = path_1.default.join(workflowNodesDir, versionDir);
            const supportedNodes = new Map();
            const capabilities = new Set(["basic_nodes"]);
            try {
                const nodeFiles = await promises_1.default.readdir(versionPath);
                const jsonFiles = nodeFiles.filter(file => file.endsWith('.json'));
                let langchainCount = 0;
                let aiCount = 0;
                let triggerCount = 0;
                for (const nodeFile of jsonFiles) {
                    try {
                        const nodeFilePath = path_1.default.join(versionPath, nodeFile);
                        const nodeContent = await promises_1.default.readFile(nodeFilePath, 'utf8');
                        const nodeDefinition = JSON.parse(nodeContent);
                        if (nodeDefinition.nodeType && nodeDefinition.version) {
                            const nodeType = nodeDefinition.nodeType;
                            // Normalize version(s) to numbers (n8n JSON sometimes stores them as strings like "4.2")
                            const rawVersions = Array.isArray(nodeDefinition.version)
                                ? nodeDefinition.version
                                : [nodeDefinition.version];
                            const versions = rawVersions
                                .map((v) => typeof v === 'number' ? v : parseFloat(String(v)))
                                .filter((v) => !Number.isNaN(v));
                            if (!supportedNodes.has(nodeType)) {
                                supportedNodes.set(nodeType, new Set());
                            }
                            versions.forEach((v) => supportedNodes.get(nodeType).add(v));
                            const nodeTypeStr = nodeType.toLowerCase();
                            const displayName = (nodeDefinition.displayName || '').toLowerCase();
                            const fileName = nodeFile.toLowerCase();
                            if (nodeTypeStr.includes('langchain') || fileName.includes('langchain')) {
                                langchainCount++;
                            }
                            if (nodeTypeStr.includes('ai') || nodeTypeStr.includes('openai') ||
                                nodeTypeStr.includes('llm') || nodeTypeStr.includes('agent') ||
                                displayName.includes('ai') || fileName.includes('ai') ||
                                fileName.includes('openai') || fileName.includes('llm')) {
                                aiCount++;
                            }
                            if (nodeTypeStr.includes('trigger') || fileName.includes('trigger')) {
                                triggerCount++;
                            }
                        }
                    }
                    catch {
                        // skip bad files
                    }
                }
                if (triggerCount > 0)
                    capabilities.add("webhook_triggers");
                if (langchainCount > 0)
                    capabilities.add(langchainCount < 10 ? "langchain_basic" : "langchain_full");
                if (aiCount > 0) {
                    capabilities.add("ai_nodes");
                    if (aiCount > 5)
                        capabilities.add("advanced_ai");
                }
            }
            catch {
                // version dir read failure
            }
            versionMappings[versionDir] = {
                version: versionDir,
                supportedNodes,
                capabilities: Array.from(capabilities)
            };
        }
    }
    catch {
        // fallback flat directory
        const supportedNodes = new Map();
        const capabilities = ["basic_nodes", "webhook_triggers"];
        try {
            const files = await promises_1.default.readdir(workflowNodesDir);
            const jsonFiles = files.filter(file => file.endsWith('.json'));
            for (const file of jsonFiles) {
                try {
                    const filePath = path_1.default.join(workflowNodesDir, file);
                    const fileContent = await promises_1.default.readFile(filePath, 'utf8');
                    const nodeDefinition = JSON.parse(fileContent);
                    if (nodeDefinition.nodeType && nodeDefinition.version) {
                        const nodeType = nodeDefinition.nodeType;
                        const versions = Array.isArray(nodeDefinition.version) ? nodeDefinition.version : [nodeDefinition.version];
                        if (!supportedNodes.has(nodeType))
                            supportedNodes.set(nodeType, new Set());
                        versions.forEach((v) => supportedNodes.get(nodeType).add(v));
                    }
                }
                catch {
                    // skip
                }
            }
        }
        catch {
            // skip
        }
        versionMappings["latest"] = { version: "latest", supportedNodes, capabilities };
    }
    supportedN8nVersions.clear();
    for (const [version, info] of Object.entries(versionMappings)) {
        supportedN8nVersions.set(version, info);
    }
}
async function detectN8nVersion() {
    if (N8N_VERSION_OVERRIDE)
        return N8N_VERSION_OVERRIDE;
    if (N8N_API_URL) {
        try {
            const baseUrl = N8N_API_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
            const settingsEndpoint = `${baseUrl}/rest/settings`;
            try {
                const response = await fetch(settingsEndpoint, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(process.env.N8N_API_KEY && { 'X-N8N-API-KEY': process.env.N8N_API_KEY })
                    },
                    signal: AbortSignal.timeout(5000)
                });
                if (response.ok) {
                    const data = await response.json();
                    const settingsData = data.data || data;
                    const version = settingsData.versionCli || settingsData.version || settingsData.n8nVersion;
                    if (version)
                        return version;
                }
            }
            catch { }
            const endpoints = [
                `${baseUrl}/version`,
                `${baseUrl}/healthz`,
                `${baseUrl}/status`,
                `${baseUrl}/info`
            ];
            for (const endpoint of endpoints) {
                try {
                    const response = await fetch(endpoint, { method: 'GET', headers: { 'Content-Type': 'application/json', ...(process.env.N8N_API_KEY && { 'X-N8N-API-KEY': process.env.N8N_API_KEY }) }, signal: AbortSignal.timeout(5000) });
                    if (response.ok) {
                        const data = await response.json();
                        const version = data.version || data.n8nVersion || data.build?.version || data.info?.version;
                        if (version)
                            return version;
                    }
                }
                catch { }
            }
        }
        catch { }
    }
    const latestVersion = Array.from(supportedN8nVersions.keys()).sort((a, b) => compareSemver(b, a))[0];
    return latestVersion || "1.104.1";
}
async function setN8nVersion(version) {
    // Prefer exact, otherwise choose best matching lower/equal version from available directories.
    const available = Array.from(supportedN8nVersions.keys());
    if (supportedN8nVersions.has(version)) {
        currentN8nVersion = version;
        n8nVersionInfo = supportedN8nVersions.get(version);
        return;
    }
    // Find best <= match
    const normalize = (v) => v.replace(/^v/i, '');
    const parse = (v) => normalize(v).split('.').map(n => parseInt(n, 10) || 0);
    const [tMaj, tMin, tPat] = parse(version);
    const sorted = available.slice().sort((a, b) => compareSemver(b, a));
    let chosen = null;
    for (const v of sorted) {
        const [vMaj, vMin, vPat] = parse(v);
        if (vMaj < tMaj ||
            (vMaj === tMaj && (vMin < tMin || (vMin === tMin && vPat <= tPat)))) {
            chosen = v;
            break;
        }
    }
    if (chosen && supportedN8nVersions.has(chosen)) {
        currentN8nVersion = chosen;
        n8nVersionInfo = supportedN8nVersions.get(chosen);
        return;
    }
    // Fallback to highest available or legacy default
    const latestVersion = sorted[0] || "latest";
    currentN8nVersion = latestVersion;
    n8nVersionInfo = supportedN8nVersions.get(latestVersion) || null;
}
