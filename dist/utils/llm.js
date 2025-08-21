"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLLMParameters = normalizeLLMParameters;
const id_1 = require("./id");
function normalizeLLMParameters(params) {
    const normalized = { ...params };
    if (normalized.modelName && !normalized.model) {
        normalized.model = normalized.modelName;
        delete normalized.modelName;
    }
    if (normalized.model && typeof normalized.model === 'string') {
        const modelValue = normalized.model;
        normalized.model = {
            "__rl": true,
            "value": modelValue,
            "mode": "list",
            "cachedResultName": modelValue
        };
    }
    if (normalized.options?.credentials?.providerType) {
        const credType = normalized.options.credentials.providerType;
        delete normalized.options.credentials;
        if (credType === 'openAi' || credType === 'openAiApi') {
            normalized.credentials = {
                "openAiApi": {
                    "id": (0, id_1.generateN8nId)(),
                    "name": "OpenAi account"
                }
            };
        }
    }
    if (normalized.credentialsType && !normalized.credentials) {
        const credType = normalized.credentialsType;
        if (credType === 'openAi' || credType === 'openAiApi') {
            normalized.credentials = {
                "openAiApi": {
                    "id": (0, id_1.generateN8nId)(),
                    "name": "OpenAi account"
                }
            };
        }
        delete normalized.credentialsType;
    }
    return normalized;
}
