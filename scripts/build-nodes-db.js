#!/usr/bin/env node
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
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

function sha256Hex(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function gzipBuffer(text) {
    return zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
}

function tableHasColumn(db, table, column) {
    try {
        const info = db.prepare(`PRAGMA table_info('${table}')`).all();
        return info.some(r => r.name === column);
    } catch {
        return false;
    }
}

function createNewSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS versions (
            version TEXT PRIMARY KEY,
            builtAt INTEGER NOT NULL,
            numNodes INTEGER NOT NULL,
            sha256 TEXT
        );
        CREATE TABLE IF NOT EXISTS blobs (
            sha256 TEXT PRIMARY KEY,
            gz BLOB NOT NULL,
            len INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT NOT NULL,
            version TEXT NOT NULL,
            nodeType TEXT NOT NULL,
            baseName TEXT,
            typeVersion TEXT,
            filename TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            PRIMARY KEY(id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_nodes_version ON nodes(version);
        CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(nodeType);
        CREATE INDEX IF NOT EXISTS idx_nodes_basename ON nodes(baseName);
    `);
}

function migrateLegacyRawSchema(db) {
    const hasRaw = tableHasColumn(db, 'nodes', 'raw');
    if (!hasRaw) return false;

    console.error('[migrate] legacy "raw" column detected, migrating to dedup+gzip schema...');
    const started = Date.now();

    db.exec(`
        CREATE TABLE IF NOT EXISTS blobs (
            sha256 TEXT PRIMARY KEY,
            gz BLOB NOT NULL,
            len INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS nodes_new (
            id TEXT NOT NULL,
            version TEXT NOT NULL,
            nodeType TEXT NOT NULL,
            baseName TEXT,
            typeVersion TEXT,
            filename TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            PRIMARY KEY(id, version)
        );
    `);

    const insBlob = db.prepare('INSERT OR IGNORE INTO blobs(sha256, gz, len) VALUES(?, ?, ?)');
    const insNode = db.prepare('INSERT OR REPLACE INTO nodes_new(id, version, nodeType, baseName, typeVersion, filename, sha256) VALUES(?, ?, ?, ?, ?, ?, ?)');
    // Paginate by rowid to avoid "database busy" while other statements run.
    const pageSize = 2000;
    const selectPage = db.prepare(
        'SELECT rowid, id, version, nodeType, baseName, typeVersion, filename, raw FROM nodes WHERE rowid > ? ORDER BY rowid LIMIT ?'
    );

    let n = 0;
    db.exec('BEGIN');
    try {
        let lastRowId = 0;
        while (true) {
            const page = selectPage.all(lastRowId, pageSize);
            if (page.length === 0) break;
            for (const row of page) {
                const hash = sha256Hex(row.raw);
                const gz = gzipBuffer(row.raw);
                insBlob.run(hash, gz, Buffer.byteLength(row.raw, 'utf8'));
                insNode.run(row.id, row.version, row.nodeType, row.baseName, row.typeVersion, row.filename, hash);
                lastRowId = row.rowid;
                n++;
            }
            console.error(`[migrate] processed ${n} rows...`);
        }
        db.exec('DROP TABLE nodes');
        db.exec('ALTER TABLE nodes_new RENAME TO nodes');
        db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_version ON nodes(version)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(nodeType)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_nodes_basename ON nodes(baseName)');
        db.exec('COMMIT');
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }

    db.exec('VACUUM');

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const blobCount = db.prepare('SELECT COUNT(*) as c FROM blobs').get().c;
    console.error(`[migrate] done in ${elapsed}s: ${n} node rows, ${blobCount} unique blobs`);
    return true;
}

function openDbWritable(dbPath) {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Attempt legacy migration first (a no-op if schema is already new).
    migrateLegacyRawSchema(db);

    // Ensure new schema exists for fresh databases.
    createNewSchema(db);

    return db;
}

function buildVersion(db, root, version) {
    const dir = path.join(root, version);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const builtAt = Date.now();
    const hash = crypto.createHash('sha256');

    const delNodes = db.prepare('DELETE FROM nodes WHERE version = ?');
    const upsertVersion = db.prepare('INSERT INTO versions(version, builtAt, numNodes, sha256) VALUES(?, ?, ?, ?) ON CONFLICT(version) DO UPDATE SET builtAt=excluded.builtAt, numNodes=excluded.numNodes, sha256=excluded.sha256');
    const insBlob = db.prepare('INSERT OR IGNORE INTO blobs(sha256, gz, len) VALUES(?, ?, ?)');
    const insNode = db.prepare('INSERT OR REPLACE INTO nodes(id, version, nodeType, baseName, typeVersion, filename, sha256) VALUES(?, ?, ?, ?, ?, ?, ?)');

    db.transaction(() => {
        delNodes.run(version);
        let inserted = 0;
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
                const contentSha = sha256Hex(content);
                const gz = gzipBuffer(content);
                insBlob.run(contentSha, gz, Buffer.byteLength(content, 'utf8'));
                insNode.run(id, version, nodeType, baseName, typeVersion, file, contentSha);
                inserted++;
            } catch {
                // skip invalid file
            }
        }
        const sha256 = hash.digest('hex');
        upsertVersion.run(version, builtAt, inserted, sha256);
    })();
}

function gcOrphanBlobs(db) {
    const info = db.prepare('DELETE FROM blobs WHERE sha256 NOT IN (SELECT DISTINCT sha256 FROM nodes)').run();
    if (info.changes > 0) {
        console.error(`[gc] removed ${info.changes} orphan blobs`);
        db.exec('VACUUM');
    }
}

function removeAll(db) {
    db.exec('DELETE FROM nodes; DELETE FROM blobs; DELETE FROM versions; VACUUM;');
}

async function main() {
    const args = parseArgs(process.argv);
    const root = path.resolve(String(args.source));
    const dbPath = path.resolve(String(args.db || defaultDbPath()));
    await ensureDir(path.dirname(dbPath));
    const db = openDbWritable(dbPath);

    try {
        if (args.full) {
            removeAll(db);
        }

        if (args.version) {
            buildVersion(db, root, String(args.version));
        } else {
            const ents = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
            const versions = ents.filter(e => e.isDirectory?.()).map(e => e.name);
            for (const v of versions) {
                buildVersion(db, root, v);
            }
        }

        gcOrphanBlobs(db);

        const stats = {
            versions: db.prepare('SELECT COUNT(*) as c FROM versions').get().c,
            nodes: db.prepare('SELECT COUNT(*) as c FROM nodes').get().c,
            blobs: db.prepare('SELECT COUNT(*) as c FROM blobs').get().c,
        };
        console.log(JSON.stringify({ success: true, dbPath, ...stats }));
    } catch (e) {
        console.error(e?.stack || String(e));
        process.exit(1);
    } finally {
        try { db.close(); } catch { }
    }
}

main();
