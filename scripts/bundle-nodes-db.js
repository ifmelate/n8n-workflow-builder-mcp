#!/usr/bin/env node
// Copies the built SQLite nodes catalog into ./dist so it ships with the npm package.
// Intended to run as a postbuild step. Skips silently if no catalog exists yet
// so that plain `tsc` builds during development don't fail.

const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveSource() {
    const envPath = process.env.N8N_NODES_DB_PATH?.trim();
    if (envPath) return path.resolve(envPath);
    // Prefer the committed catalog at repo root — this is what CI sees.
    const repoRoot = path.resolve(__dirname, '..', 'catalog.sqlite');
    if (fs.existsSync(repoRoot)) return repoRoot;
    // Fall back to the developer's user cache, populated by `npm run build:nodes-db`.
    const home = os.homedir();
    if (!home) return null;
    return path.join(home, '.cache', 'n8n-nodes', 'catalog.sqlite');
}

function main() {
    const src = resolveSource();
    const dest = path.resolve(__dirname, '..', 'dist', 'catalog.sqlite');

    if (!src || !fs.existsSync(src)) {
        console.warn(`[bundle-nodes-db] source catalog not found at ${src || '<unknown>'}, skipping. Run "npm run build:nodes-db" first.`);
        return;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    const sizeMb = (fs.statSync(dest).size / 1024 / 1024).toFixed(2);
    console.log(`[bundle-nodes-db] copied ${src} -> ${dest} (${sizeMb} MB)`);
}

main();
