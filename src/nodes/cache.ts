import fs from 'fs/promises';
import path from 'path';
import { getCurrentN8nVersion, getN8nVersionInfo } from './versioning';

export interface CachedNodeInfo {
    officialType: string;
    version: number | number[];
}

let nodeInfoCache: Map<string, CachedNodeInfo> = new Map();

export function getNodeInfoCache(): Map<string, CachedNodeInfo> {
    return nodeInfoCache;
}

export function clearNodeInfoCache(): void {
    nodeInfoCache.clear();
}

export function normalizeNodeTypeAndVersion(inputType: string, inputVersion?: number): { finalNodeType: string; finalTypeVersion: number } {
    const lowerInputType = inputType.toLowerCase();
    const prefix = "n8n-nodes-base.";
    const cacheEntry = nodeInfoCache.get(lowerInputType);

    let finalNodeType: string;
    let versionSource: number | number[] = 1;

    if (cacheEntry) {
        finalNodeType = cacheEntry.officialType;
        versionSource = cacheEntry.version;
    } else {
        if (inputType.includes('/') && !lowerInputType.startsWith(prefix)) {
            finalNodeType = inputType;
        } else {
            finalNodeType = lowerInputType.startsWith(prefix) ? inputType : `${prefix}${inputType}`;
        }
    }

    let finalTypeVersion: number;
    if (inputVersion !== undefined && !isNaN(Number(inputVersion))) {
        finalTypeVersion = Number(inputVersion);
    } else {
        // Choose the highest version we know for the node. If running under a specific
        // n8n version with known supported nodes, clamp to the highest compatible one.
        const preferredMax = Array.isArray(versionSource)
            ? Math.max(...versionSource.map(v => Number(v)).filter(v => !isNaN(v)))
            : Number(versionSource);
        let candidate = Number.isFinite(preferredMax) ? preferredMax : 1;

        const info = getN8nVersionInfo();
        const supported = info?.supportedNodes.get((nodeInfoCache.get(lowerInputType)?.officialType) || finalNodeType);
        if (supported && supported.size > 0) {
            // pick the highest supported version <= candidate
            const supportedList = Array.from(supported).map(v => Number(v)).filter(v => !isNaN(v));
            supportedList.sort((a, b) => b - a);
            const matched = supportedList.find(v => v <= candidate) ?? supportedList[0];
            candidate = matched ?? candidate;
        }
        finalTypeVersion = Number.isFinite(candidate) ? candidate : 1;
    }

    return { finalNodeType, finalTypeVersion };
}

export async function loadKnownNodeBaseTypes(): Promise<void> {
    const workflowNodesDir = path.resolve(__dirname, '../workflow_nodes');
    try {
        const entries = await fs.readdir(workflowNodesDir, { withFileTypes: true });
        const versionDirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);

        let searchDirs: string[] = [];
        if (versionDirs.length > 0) {
            const targetVersion = getCurrentN8nVersion() || versionDirs.sort((a, b) => compareSemver(b, a))[0];
            const bestMatchVersion = findBestMatchingVersion(targetVersion, versionDirs);
            const versionToUse = bestMatchVersion || versionDirs.sort((a, b) => parseFloat(b) - parseFloat(a))[0];
            searchDirs = [path.join(workflowNodesDir, versionToUse)];
        } else {
            searchDirs = [workflowNodesDir];
        }

        nodeInfoCache.clear();
        for (const dir of searchDirs) {
            await loadNodesFromDirectory(dir);
        }
    } catch {
        nodeInfoCache = new Map();
    }
}

export async function updateNodeCacheForVersion(): Promise<void> {
    const info = getN8nVersionInfo();
    if (!info) return;
    const filtered = new Map<string, CachedNodeInfo>();
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
        } else {
            const isBasicNode = !nodeInfo.officialType.includes('@n8n/n8n-nodes-langchain') &&
                !nodeInfo.officialType.toLowerCase().includes('ai');
            if (isBasicNode) filtered.set(key, nodeInfo);
        }
    }
    nodeInfoCache = filtered;
}

async function loadNodesFromDirectory(directory: string): Promise<void> {
    try {
        const files = await fs.readdir(directory);
        const suffix = ".json";
        for (const file of files) {
            if (file.endsWith(suffix)) {
                try {
                    const filePath = path.join(directory, file);
                    const fileContent = await fs.readFile(filePath, 'utf8');
                    const nodeDefinition = JSON.parse(fileContent);
                    if (nodeDefinition.nodeType) {
                        const officialType = nodeDefinition.nodeType;
                        // Normalize stored version to a number where possible to align with compatibility checks
                        const rawVersion = nodeDefinition.version ?? 1;
                        const normalizedVersion = Array.isArray(rawVersion)
                            ? rawVersion
                                .map((v: any) => typeof v === 'number' ? v : parseFloat(String(v)))
                                .filter((v: number) => !Number.isNaN(v))
                            : (typeof rawVersion === 'number' ? rawVersion : parseFloat(String(rawVersion)));
                        nodeInfoCache.set(officialType.toLowerCase(), { officialType, version: normalizedVersion });
                        const prefix = "n8n-nodes-base.";
                        if (officialType.startsWith(prefix)) {
                            const baseName = officialType.substring(prefix.length);
                            if (baseName) nodeInfoCache.set(baseName.toLowerCase(), { officialType, version: normalizedVersion });
                        }
                    }
                } catch {
                    // skip
                }
            }
        }
    } catch {
        // skip
    }
}

export function isNodeTypeSupported(nodeType: string, nodeVersion?: number): boolean {
    const info = getN8nVersionInfo();
    if (!info) return true;
    const supported = info.supportedNodes.get(nodeType);
    if (!supported) {
        const typeLower = nodeType.toLowerCase();
        const hasAi = typeLower.includes('ai') || typeLower.includes('openai') || typeLower.includes('llm');
        const hasLangchain = nodeType.includes('@n8n/n8n-nodes-langchain');
        const currentVersionNum = parseFloat((getCurrentN8nVersion() || '1.30.0'));
        if (hasLangchain && currentVersionNum < 1.10) return false;
        if (hasAi && currentVersionNum < 1.20) return false;
        return true;
    }
    if (nodeVersion !== undefined) return supported.has(nodeVersion);
    return supported.size > 0;
}

export function findBestMatchingVersion(targetVersion: string, availableVersions: string[]): string | null {
    const normalize = (v: string) => v.replace(/^v/i, '');
    const parse = (v: string) => normalize(v).split('.').map(n => parseInt(n, 10) || 0);
    const [tMaj, tMin, tPat] = parse(targetVersion);
    const sorted = availableVersions.slice().sort((a, b) => compareSemver(b, a));
    for (const v of sorted) {
        const [vMaj, vMin, vPat] = parse(v);
        if (
            vMaj < tMaj ||
            (vMaj === tMaj && vMin <= tMin)
        ) return v;
    }
    return null;
}

function compareSemver(a: string, b: string): number {
    const normalize = (v: string) => v.replace(/^v/i, '');
    const pa = normalize(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = normalize(b).split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = pa[i] ?? 0;
        const nb = pb[i] ?? 0;
        if (na !== nb) return na - nb;
    }
    return 0;
}


