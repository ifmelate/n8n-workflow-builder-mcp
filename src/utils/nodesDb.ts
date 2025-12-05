import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { getCurrentN8nVersion } from '../nodes/versioning';

/**
 * Environment helpers for nodes DB and cache settings.
 */
function getNodesDbPath(): string | null {
    const envPath = process.env.N8N_NODES_DB_PATH?.trim();
    if (envPath && envPath.length > 0) {
        return path.resolve(envPath);
    }
    // Default under user cache dir
    const home = os.homedir();
    if (!home) return null;
    const defaultDir = path.join(home, '.cache', 'n8n-nodes');
    return path.join(defaultDir, 'catalog.sqlite');
}

function getWorkflowNodesRootDir(): string {
    // Existing code expects workflow_nodes relative to compiled dist path
    // Keep compatibility by materializing into project root workflow_nodes
    return path.resolve(__dirname, '../../workflow_nodes');
}

async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true }).catch(() => { });
}

function openDb(dbPath: string, readOnly = true): Database.Database {
    const db = new Database(dbPath, { readonly: readOnly, fileMustExist: true });
    return db;
}

export interface NodesDbVersionRow {
    version: string;
    builtAt: number;
    numNodes: number;
    sha256?: string | null;
}

export interface NodesDbNodeRow {
    id: string; // filename without extension
    version: string;
    nodeType: string;
    baseName?: string | null;
    typeVersion?: string | number | null; // stored as JSON or number
    filename: string; // original filename, e.g., http_request.json
    raw: string; // raw JSON string
}

function readVersionMeta(db: Database.Database, version: string): NodesDbVersionRow | null {
    try {
        const row = db.prepare(
            'SELECT version, builtAt, numNodes, sha256 FROM versions WHERE version = ?'
        ).get(version) as NodesDbVersionRow | undefined;
        return row || null;
    } catch {
        return null;
    }
}

function* iterateNodes(db: Database.Database, version: string): Generator<NodesDbNodeRow> {
    const stmt = db.prepare(
        'SELECT id, version, nodeType, baseName, typeVersion, filename, raw FROM nodes WHERE version = ?'
    );
    for (const row of stmt.iterate(version)) {
        yield row as NodesDbNodeRow;
    }
}

async function directoryExists(dir: string): Promise<boolean> {
    try {
        const st = await fs.stat(dir);
        return st.isDirectory();
    } catch {
        return false;
    }
}

async function countJsonFiles(dir: string): Promise<number> {
    try {
        const files = await fs.readdir(dir);
        return files.filter(f => f.endsWith('.json')).length;
    } catch {
        return 0;
    }
}

export async function materializeVersionFromDb(version: string, opts?: { targetRootDir?: string; force?: boolean }): Promise<{ ok: boolean; reason?: string }> {
    const dbPath = getNodesDbPath();
    if (!dbPath) return { ok: false, reason: 'No DB path resolved' };

    const targetRoot = opts?.targetRootDir || getWorkflowNodesRootDir();
    const targetDir = path.join(targetRoot, version);
    await ensureDir(targetDir);

    let db: Database.Database | null = null;
    try {
        db = openDb(dbPath, true);
    } catch (e: any) {
        return { ok: false, reason: `Open DB failed: ${e?.message || String(e)}` };
    }

    try {
        const meta = readVersionMeta(db, version);
        if (!meta) {
            return { ok: false, reason: `Version ${version} not found in DB` };
        }

        const existing = await countJsonFiles(targetDir);
        if (!opts?.force && existing >= (meta.numNodes || 0) && existing > 0) {
            // Assume already materialized
            return { ok: true };
        }

        // Clean directory before writing (only JSON files)
        try {
            const files = await fs.readdir(targetDir);
            await Promise.all(
                files.filter(f => f.endsWith('.json')).map(f => fs.rm(path.join(targetDir, f)).catch(() => { }))
            );
        } catch { }

        // Write nodes
        const writer = async (row: NodesDbNodeRow) => {
            const outFile = path.join(targetDir, row.filename || `${row.id}.json`);
            await fs.writeFile(outFile, row.raw, 'utf8');
        };

        for (const row of iterateNodes(db, version)) {
            await writer(row);
        }

        const after = await countJsonFiles(targetDir);
        if (after === 0) {
            return { ok: false, reason: 'No files written' };
        }
        return { ok: true };
    } finally {
        try { db?.close(); } catch { }
    }
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

export function listDbVersions(): string[] {
    const dbPath = getNodesDbPath();
    if (!dbPath) return [];
    let db: Database.Database | null = null;
    try {
        db = openDb(dbPath, true);
        const rows = db.prepare('SELECT version FROM versions').all() as Array<{ version: string }>;
        return rows.map(r => r.version);
    } catch {
        return [];
    } finally {
        try { db?.close(); } catch { }
    }
}

export async function materializeBestVersion(preferred?: string, opts?: { force?: boolean }): Promise<{ ok: boolean; version?: string; reason?: string }> {
    const versions = listDbVersions();
    if (versions.length === 0) return { ok: false, reason: 'DB has no versions' };

    let chosen: string | undefined;
    if (preferred && versions.includes(preferred)) {
        chosen = preferred;
    } else if (preferred) {
        // choose best <= preferred
        const sorted = versions.slice().sort((a, b) => compareSemver(b, a));
        const pv = preferred;
        for (const v of sorted) {
            if (compareSemver(v, pv) <= 0) { chosen = v; break; }
        }
        if (!chosen) chosen = sorted[0];
    } else {
        chosen = versions.slice().sort((a, b) => compareSemver(b, a))[0];
    }

    const res = await materializeVersionFromDb(chosen!, { force: opts?.force });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, version: chosen };
}

export async function materializeIfConfigured(): Promise<void> {
    // Always materialize from DB
    // Prefer env override, then current version if already set, then latest in DB
    const preferred = process.env.N8N_VERSION || getCurrentN8nVersion() || undefined;
    const out = await materializeBestVersion(preferred).catch((e: any) => ({ ok: false as const, reason: e?.message || String(e) }));
    if (!out.ok) {
        console.warn(`[WARN] Failed to materialize nodes from DB: ${out.reason || 'unknown error'}`);
        return;
    }
    const chosenVersion = (out as { ok: true; version?: string }).version;
    console.error(`[DEBUG] Materialized nodes for version ${chosenVersion || preferred || 'latest'} from DB into ${getWorkflowNodesRootDir()}`);
}



