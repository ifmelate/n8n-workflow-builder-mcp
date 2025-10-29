#!/usr/bin/env node
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Database = require('better-sqlite3');

function usage() {
    console.error('Usage: build-nodes-db --source <workflow_nodes_dir> [--version <X.Y.Z>] [--db <db_path>] [--full-rebuild]');
    process.exit(1);
}

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--source') args.source = argv[++i];
        else if (a === '--version') args.version = argv[++i];
        else if (a === '--db') args.db = argv[++i];
        else if (a === '--full-rebuild') args.full = true;
        else if (a === '--help' || a === '-h') usage();
        else {
            console.error(`Unknown arg: ${a}`);
            usage();
        }
    }
    if (!args.source) usage();
    return args;
}

function defaultDbPath() {
    const home = os.homedir();
    const dir = home ? path.join(home, '.cache', 'n8n-nodes') : process.cwd();
    return path.join(dir, 'catalog.sqlite');
}

async function ensureDir(dir) {
    await fsp.mkdir(dir, { recursive: true }).catch(() => { });
}

function openDbWritable(dbPath) {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS versions (
            version TEXT PRIMARY KEY,
            builtAt INTEGER NOT NULL,
            numNodes INTEGER NOT NULL,
            sha256 TEXT
        );
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT NOT NULL,
            version TEXT NOT NULL,
            nodeType TEXT NOT NULL,
            baseName TEXT,
            typeVersion TEXT,
            filename TEXT NOT NULL,
            raw TEXT NOT NULL,
            PRIMARY KEY(id, version),
            FOREIGN KEY(version) REFERENCES versions(version)
        );
        CREATE INDEX IF NOT EXISTS idx_nodes_version ON nodes(version);
        CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(nodeType);
        CREATE INDEX IF NOT EXISTS idx_nodes_basename ON nodes(baseName);
    `);

    // Ensure composite primary key (id, version) for existing databases
    try {
        const info = db.prepare("PRAGMA table_info('nodes')").all();
        const pkCols = info.filter(r => r.pk > 0).map(r => r.name);
        const needsMigration = !(pkCols.length === 2 && pkCols.includes('id') && pkCols.includes('version'));
        if (needsMigration && info.length > 0) {
            db.exec('BEGIN');
            db.exec(`
                CREATE TABLE IF NOT EXISTS nodes_new (
                    id TEXT NOT NULL,
                    version TEXT NOT NULL,
                    nodeType TEXT NOT NULL,
                    baseName TEXT,
                    typeVersion TEXT,
                    filename TEXT NOT NULL,
                    raw TEXT NOT NULL,
                    PRIMARY KEY(id, version)
                );
            `);
            try {
                db.exec(`INSERT OR REPLACE INTO nodes_new (id, version, nodeType, baseName, typeVersion, filename, raw)
                         SELECT id, version, nodeType, baseName, typeVersion, filename, raw FROM nodes`);
            } catch (e) {
                // ignore if old table empty or missing columns
            }
            db.exec('DROP TABLE IF EXISTS nodes');
            db.exec('ALTER TABLE nodes_new RENAME TO nodes');
            db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_version ON nodes(version)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(nodeType)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_basename ON nodes(baseName)');
            db.exec('COMMIT');
        }
    } catch (e) {
        // best effort
    }
    return db;
}

async function listVersionDirs(root) {
    try {
        const ents = await fsp.readdir(root, { withFileTypes: true });
        return ents.filter(e => e.isDirectory?.() === true).map(e => e.name);
    } catch {
        const names = await fsp.readdir(root);
        const results = [];
        for (const name of names) {
            try {
                const st = await fsp.stat(path.join(root, name));
                if (st.isDirectory()) results.push(name);
            } catch { }
        }
        return results;
    }
}

async function listJsonFiles(dir) {
    try {
        const files = await fsp.readdir(dir);
        return files.filter(f => f.endsWith('.json'));
    } catch {
        return [];
    }
}

async function buildVersion(db, root, version) {
    const dir = path.join(root, version);
    const files = await listJsonFiles(dir);
    const builtAt = Date.now();
    const hash = crypto.createHash('sha256');

    const delNodes = db.prepare('DELETE FROM nodes WHERE version = ?');
    const upsertVersion = db.prepare('INSERT INTO versions(version, builtAt, numNodes, sha256) VALUES(?, ?, ?, ?) ON CONFLICT(version) DO UPDATE SET builtAt=excluded.builtAt, numNodes=excluded.numNodes, sha256=excluded.sha256');
    const insNode = db.prepare('INSERT OR REPLACE INTO nodes(id, version, nodeType, baseName, typeVersion, filename, raw) VALUES(?, ?, ?, ?, ?, ?, ?)');

    db.transaction(() => {
        delNodes.run(version);
        for (const file of files) {
            const content = fs.readFileSync(path.join(dir, file), 'utf8');
            hash.update(content);
            try {
                const def = JSON.parse(content);
                const nodeType = def?.nodeType;
                if (!nodeType) continue;
                const id = path.basename(file, '.json');
                const baseName = nodeType.startsWith('n8n-nodes-base.') ? nodeType.substring('n8n-nodes-base.'.length) : null;
                const typeVersion = def?.version !== undefined ? JSON.stringify(def.version) : null;
                insNode.run(id, version, nodeType, baseName, typeVersion, file, content);
            } catch {
                // skip invalid file
            }
        }
        const sha256 = hash.digest('hex');
        upsertVersion.run(version, builtAt, files.length, sha256);
    })();
}

async function removeAll(db) {
    db.exec('DELETE FROM nodes; DELETE FROM versions; VACUUM;');
}

async function main() {
    const args = parseArgs(process.argv);
    const root = path.resolve(String(args.source));
    const dbPath = path.resolve(String(args.db || defaultDbPath()));
    await ensureDir(path.dirname(dbPath));
    const db = openDbWritable(dbPath);

    try {
        if (args.full) {
            await removeAll(db);
        }

        if (args.version) {
            await buildVersion(db, root, String(args.version));
        } else {
            const versions = await listVersionDirs(root);
            for (const v of versions) {
                await buildVersion(db, root, v);
            }
        }

        console.log(JSON.stringify({ success: true, dbPath }));
    } catch (e) {
        console.error(e?.stack || String(e));
        process.exit(1);
    } finally {
        try { db.close(); } catch { }
    }
}

main();




