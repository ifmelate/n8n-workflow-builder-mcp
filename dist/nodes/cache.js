"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNodeInfoCache = getNodeInfoCache;
exports.clearNodeInfoCache = clearNodeInfoCache;
exports.normalizeNodeTypeAndVersion = normalizeNodeTypeAndVersion;
exports.loadKnownNodeBaseTypes = loadKnownNodeBaseTypes;
exports.updateNodeCacheForVersion = updateNodeCacheForVersion;
exports.isNodeTypeSupported = isNodeTypeSupported;
exports.findBestMatchingVersion = findBestMatchingVersion;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const versioning_1 = require("./versioning");
let nodeInfoCache = new Map();
function getNodeInfoCache() {
    return nodeInfoCache;
}
function clearNodeInfoCache() {
    nodeInfoCache.clear();
}
function normalizeNodeTypeAndVersion(inputType, inputVersion) {
    const lowerInputType = inputType.toLowerCase();
    const prefix = "n8n-nodes-base.";
    const cacheEntry = nodeInfoCache.get(lowerInputType);
    let finalNodeType;
    let versionSource = 1;
    if (cacheEntry) {
        finalNodeType = cacheEntry.officialType;
        versionSource = cacheEntry.version;
    }
    else {
        if (inputType.includes('/') && !lowerInputType.startsWith(prefix)) {
            finalNodeType = inputType;
        }
        else {
            finalNodeType = lowerInputType.startsWith(prefix) ? inputType : `${prefix}${inputType}`;
        }
    }
    let finalTypeVersion;
    if (inputVersion !== undefined && !isNaN(Number(inputVersion))) {
        finalTypeVersion = Number(inputVersion);
    }
    else {
        if (Array.isArray(versionSource)) {
            const numericVersions = versionSource.map(v => Number(v)).filter(v => !isNaN(v));
            finalTypeVersion = numericVersions.length > 0 ? Math.max(...numericVersions) : 1;
        }
        else {
            finalTypeVersion = Number(versionSource);
        }
        if (isNaN(finalTypeVersion))
            finalTypeVersion = 1;
    }
    return { finalNodeType, finalTypeVersion };
}
async function loadKnownNodeBaseTypes() {
    const workflowNodesDir = path_1.default.resolve(__dirname, '../workflow_nodes');
    try {
        const entries = await promises_1.default.readdir(workflowNodesDir, { withFileTypes: true });
        const versionDirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
        let searchDirs = [];
        if (versionDirs.length > 0) {
            const targetVersion = (0, versioning_1.getCurrentN8nVersion)() || versionDirs.sort((a, b) => compareSemver(b, a))[0];
            const bestMatchVersion = findBestMatchingVersion(targetVersion, versionDirs);
            const versionToUse = bestMatchVersion || versionDirs.sort((a, b) => parseFloat(b) - parseFloat(a))[0];
            searchDirs = [path_1.default.join(workflowNodesDir, versionToUse)];
        }
        else {
            searchDirs = [workflowNodesDir];
        }
        nodeInfoCache.clear();
        for (const dir of searchDirs) {
            await loadNodesFromDirectory(dir);
        }
    }
    catch {
        nodeInfoCache = new Map();
    }
}
async function updateNodeCacheForVersion() {
    const info = (0, versioning_1.getN8nVersionInfo)();
    if (!info)
        return;
    const filtered = new Map();
    for (const [key, nodeInfo] of nodeInfoCache.entries()) {
        const supportedVersions = info.supportedNodes.get(nodeInfo.officialType);
        if (supportedVersions && supportedVersions.size > 0) {
            const compatible = Array.isArray(nodeInfo.version)
                ? nodeInfo.version.filter(v => supportedVersions.has(v))
                : supportedVersions.has(nodeInfo.version) ? [nodeInfo.version] : [];
            if (compatible.length > 0) {
                const maxVersion = Math.max(...compatible.map(v => Number(v)));
                filtered.set(key, { ...nodeInfo, version: maxVersion });
            }
        }
        else {
            const isBasicNode = !nodeInfo.officialType.includes('@n8n/n8n-nodes-langchain') &&
                !nodeInfo.officialType.toLowerCase().includes('ai');
            if (isBasicNode)
                filtered.set(key, nodeInfo);
        }
    }
    nodeInfoCache = filtered;
}
async function loadNodesFromDirectory(directory) {
    try {
        const files = await promises_1.default.readdir(directory);
        const suffix = ".json";
        for (const file of files) {
            if (file.endsWith(suffix)) {
                try {
                    const filePath = path_1.default.join(directory, file);
                    const fileContent = await promises_1.default.readFile(filePath, 'utf8');
                    const nodeDefinition = JSON.parse(fileContent);
                    if (nodeDefinition.nodeType) {
                        const officialType = nodeDefinition.nodeType;
                        const version = nodeDefinition.version || 1;
                        nodeInfoCache.set(officialType.toLowerCase(), { officialType, version });
                        const prefix = "n8n-nodes-base.";
                        if (officialType.startsWith(prefix)) {
                            const baseName = officialType.substring(prefix.length);
                            if (baseName)
                                nodeInfoCache.set(baseName.toLowerCase(), { officialType, version });
                        }
                    }
                }
                catch {
                    // skip
                }
            }
        }
    }
    catch {
        // skip
    }
}
function isNodeTypeSupported(nodeType, nodeVersion) {
    const info = (0, versioning_1.getN8nVersionInfo)();
    if (!info)
        return true;
    const supported = info.supportedNodes.get(nodeType);
    if (!supported) {
        const typeLower = nodeType.toLowerCase();
        const hasAi = typeLower.includes('ai') || typeLower.includes('openai') || typeLower.includes('llm');
        const hasLangchain = nodeType.includes('@n8n/n8n-nodes-langchain');
        const currentVersionNum = parseFloat(((0, versioning_1.getCurrentN8nVersion)() || '1.30.0'));
        if (hasLangchain && currentVersionNum < 1.10)
            return false;
        if (hasAi && currentVersionNum < 1.20)
            return false;
        return true;
    }
    if (nodeVersion !== undefined)
        return supported.has(nodeVersion);
    return supported.size > 0;
}
function findBestMatchingVersion(targetVersion, availableVersions) {
    const normalize = (v) => v.replace(/^v/i, '');
    const parse = (v) => normalize(v).split('.').map(n => parseInt(n, 10) || 0);
    const [tMaj, tMin, tPat] = parse(targetVersion);
    const sorted = availableVersions.slice().sort((a, b) => compareSemver(b, a));
    for (const v of sorted) {
        const [vMaj, vMin, vPat] = parse(v);
        if (vMaj < tMaj ||
            (vMaj === tMaj && vMin <= tMin))
            return v;
    }
    return null;
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
