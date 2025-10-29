import fs from 'fs/promises';
import path from 'path';
import { materializeBestVersion } from '../utils/nodesDb';
import { SimpleNodeTypes } from './workflowValidator';

export async function loadNodeTypesFromDir(dir: string): Promise<SimpleNodeTypes> {
    const reg = new SimpleNodeTypes();
    try {
        const files = await fs.readdir(dir);
        for (const f of files) {
            if (!f.endsWith('.json')) continue;
            try {
                const raw = await fs.readFile(path.join(dir, f), 'utf8');
                const def = JSON.parse(raw);
                if (!def?.nodeType || !def?.properties) continue;
                const rawVersion = def.version ?? 1;
                const normalizedVersion = Array.isArray(rawVersion)
                    ? rawVersion.map((v: any) => (typeof v === 'number' ? v : parseFloat(String(v)))).filter((n: number) => !Number.isNaN(n))
                    : (typeof rawVersion === 'number' ? rawVersion : parseFloat(String(rawVersion)));
                // Preserve additional metadata used by validation when available
                const description: any = { name: def.nodeType, properties: def.properties || [] };
                if (Array.isArray(def.credentialsConfig)) description.credentialsConfig = def.credentialsConfig;
                if (def.wiring) description.wiring = def.wiring;
                reg.register(def.nodeType, normalizedVersion, description);
            } catch {
                // ignore bad file
            }
        }
    } catch {
        // directory missing or unreadable
    }
    return reg;
}

export async function loadNodeTypesForCurrentVersion(workflowNodesRoot: string, version: string | null | undefined): Promise<SimpleNodeTypes> {
    const root = workflowNodesRoot;
    // Always ensure the requested/best version is materialized from DB first.
    try {
        const preferred = version || undefined;
        await materializeBestVersion(preferred);
    } catch { }
    if (!version || version === 'latest') {
        return loadNodeTypesFromDir(root);
    }
    const versioned = path.join(root, version);
    try {
        const stat = await fs.stat(versioned);
        if (stat.isDirectory()) return loadNodeTypesFromDir(versioned);
    } catch {
        // fall through
    }
    return loadNodeTypesFromDir(root);
}


