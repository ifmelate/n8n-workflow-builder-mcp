module.exports = {
    server: {
        port: process.env.PORT || 3000,
        env: process.env.NODE_ENV || 'development',
    },
    n8n: {
        apiUrl: process.env.N8N_API_URL || 'http://localhost:5678/api/',
        apiKey: process.env.N8N_API_KEY,
        workflowsPath: process.env.N8N_WORKFLOWS_PATH || './n8n-workflows',
        integrationType: process.env.N8N_INTEGRATION_TYPE || 'auto', // 'api', 'filesystem', or 'auto'
    },
    auth: {
        jwtSecret: process.env.JWT_SECRET || 'default-dev-secret',
        jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
        apiKeys: process.env.API_KEYS ? process.env.API_KEYS.split(',') : ['dev-api-key'],
        encryptionKey: process.env.ENCRYPTION_KEY,
        keyRotationInterval: parseInt(process.env.KEY_ROTATION_INTERVAL || '30', 10), // days
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
    },
    credentials: {
        storageDir: process.env.CREDENTIALS_DIR || './config/credentials',
    },
    storage: {
        workflowsPath: process.env.WORKFLOWS_PATH || './workflow_nodes',
        versioning: {
            enabled: process.env.ENABLE_VERSIONING !== 'false',
            maxVersions: parseInt(process.env.MAX_VERSIONS || '10', 10),
        },
    },
    llm: {
        defaultProvider: process.env.LLM_DEFAULT_PROVIDER || 'openai',
        openaiApiKey: process.env.OPENAI_API_KEY,
        openaiModel: process.env.OPENAI_MODEL || 'gpt-4-turbo',
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-3-opus-20240229',
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.2'),
        maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2000', 10),
    },
}; 