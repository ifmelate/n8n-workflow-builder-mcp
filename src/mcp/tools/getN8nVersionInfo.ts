import { z } from 'zod';
import { ToolNames } from '../../utils/constants';
import { getSupportedN8nVersions, getCurrentN8nVersion, getN8nVersionInfo } from '../../nodes/versioning';
import { ok, fail } from '../responses';

export const toolName = ToolNames.get_n8n_version_info;

export const description = "Get N8N version info and capabilities";

// Schema for no-parameter tool
export const paramsSchema = z.object({
    random_string: z.string().describe("Dummy parameter for no-parameter tools")
});

export type Params = z.infer<typeof paramsSchema>;

// Handler function
export async function handler(_params: Params, _extra: any) {
    console.error("[DEBUG] get_n8n_version_info called");
    try {
        const supportedVersionsList = Array.from(getSupportedN8nVersions().keys()).sort((a, b) =>
            parseFloat(b) - parseFloat(a)
        );

        const currentInfo = getN8nVersionInfo() ? {
            version: getCurrentN8nVersion(),
            capabilities: getN8nVersionInfo()!.capabilities,
            supportedNodesCount: getN8nVersionInfo()!.supportedNodes.size
        } : null;

        return ok({
            currentVersion: getCurrentN8nVersion(),
            currentVersionInfo: currentInfo,
            supportedVersions: supportedVersionsList,
            versionSource: process.env.N8N_VERSION ? "environment_override" :
                (process.env.N8N_API_URL ? "api_detection" : "default"),
            capabilities: getN8nVersionInfo()?.capabilities || []
        });
    } catch (error: any) {
        console.error("[ERROR] Failed to get N8N version info:", error);
        return fail("Failed to get N8N version info: " + error.message);
    }
}
