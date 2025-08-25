"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKFLOWS_FILE_NAME = exports.WORKFLOW_DATA_DIR_NAME = void 0;
exports.getWorkspaceDir = getWorkspaceDir;
exports.setWorkspaceDir = setWorkspaceDir;
exports.resolvePath = resolvePath;
exports.resolveWorkflowPath = resolveWorkflowPath;
exports.ensureWorkflowParentDir = ensureWorkflowParentDir;
exports.ensureWorkflowDir = ensureWorkflowDir;
exports.tryDetectWorkspaceForName = tryDetectWorkspaceForName;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
// Workspace-scoped paths and helpers extracted from index.ts
exports.WORKFLOW_DATA_DIR_NAME = 'workflow_data';
exports.WORKFLOWS_FILE_NAME = 'workflows.json';
let WORKSPACE_DIR = process.cwd();
function getWorkspaceDir() {
    return WORKSPACE_DIR;
}
function setWorkspaceDir(dir) {
    WORKSPACE_DIR = dir;
}
function resolvePath(filepath) {
    const relativePath = filepath.replace(/^[\\/]+/, '');
    return path_1.default.join(WORKSPACE_DIR, relativePath);
}
function resolveWorkflowPath(workflowName, workflowPath) {
    if (workflowPath) {
        if (path_1.default.isAbsolute(workflowPath)) {
            return workflowPath;
        }
        return path_1.default.resolve(process.cwd(), workflowPath);
    }
    const sanitizedName = workflowName.replace(/[^a-z0-9_.-]/gi, '_');
    return resolvePath(path_1.default.join(exports.WORKFLOW_DATA_DIR_NAME, `${sanitizedName}.json`));
}
async function ensureWorkflowParentDir(filePath) {
    const parentDir = path_1.default.dirname(filePath);
    await promises_1.default.mkdir(parentDir, { recursive: true });
}
async function ensureWorkflowDir() {
    const resolvedDir = resolvePath(exports.WORKFLOW_DATA_DIR_NAME);
    await promises_1.default.mkdir(resolvedDir, { recursive: true });
}
// Best-effort workspace autodetection when a tool receives only workflow_name
// Tries common environment-provided working directories and, if a matching
// workflow file is found, updates the global WORKSPACE_DIR accordingly.
async function tryDetectWorkspaceForName(workflowName) {
    const sanitizedName = workflowName.replace(/[^a-z0-9_.-]/gi, '_');
    const candidates = [
        process.env.INIT_CWD,
        process.env.PWD,
    ];
    for (const dir of candidates) {
        if (!dir)
            continue;
        try {
            const absDir = path_1.default.resolve(dir);
            const candidateFile = path_1.default.join(absDir, exports.WORKFLOW_DATA_DIR_NAME, `${sanitizedName}.json`);
            const stat = await promises_1.default.stat(candidateFile).catch(() => null);
            if (stat && stat.isFile()) {
                setWorkspaceDir(absDir);
                return candidateFile;
            }
        }
        catch {
            // ignore and continue
        }
    }
    return null;
}
