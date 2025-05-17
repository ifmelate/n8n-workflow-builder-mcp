/**
 * Credential Model
 * 
 * Handles secure credential storage and retrieval with encryption.
 */

const fs = require('fs').promises;
const path = require('path');
const { encrypt, decrypt, generateKey } = require('../utils/encryption');
const { logger } = require('../utils/logger');

// Configuration
let config;
try {
    config = require('../../config/default');
} catch (err) {
    logger.error('Failed to load config', { error: err.message });
    config = {
        auth: { encryptionKey: process.env.ENCRYPTION_KEY }
    };
}

// Storage location for credentials
const CREDENTIALS_DIR = path.join(process.cwd(), 'config', 'credentials');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');

// Get master encryption key from environment or generate one
const MASTER_KEY = process.env.ENCRYPTION_KEY ||
    config.auth?.encryptionKey ||
    (() => {
        logger.warn('No encryption key found, generating one. THIS SHOULD NOT BE USED IN PRODUCTION.');
        const key = generateKey();
        logger.warn(`Generated encryption key: ${key}. Add this to your environment variables as ENCRYPTION_KEY.`);
        return key;
    })();

// Ensure credentials directory exists
const ensureCredentialsDir = async () => {
    try {
        await fs.mkdir(CREDENTIALS_DIR, { recursive: true });
    } catch (error) {
        logger.error('Failed to create credentials directory', { error: error.message });
        throw new Error('Failed to create credentials directory');
    }
};

// Initialize credentials storage
const initCredentialsStorage = async () => {
    await ensureCredentialsDir();

    try {
        // Check if credentials file exists
        await fs.access(CREDENTIALS_FILE);
    } catch (error) {
        // Create an empty credentials file
        await fs.writeFile(CREDENTIALS_FILE, JSON.stringify({ credentials: {}, meta: { version: '1.0', keyId: 'v1' } }));
        logger.info('Created new credentials file');
    }
};

/**
 * Loads credentials from storage
 * 
 * @returns {Object} Credentials data
 */
const loadCredentials = async () => {
    try {
        await ensureCredentialsDir();
        const data = await fs.readFile(CREDENTIALS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Failed to load credentials', { error: error.message });

        // If file doesn't exist or is corrupted, create a new one
        if (error.code === 'ENOENT' || error instanceof SyntaxError) {
            const emptyData = { credentials: {}, meta: { version: '1.0', keyId: 'v1' } };
            await fs.writeFile(CREDENTIALS_FILE, JSON.stringify(emptyData));
            return emptyData;
        }

        throw new Error('Failed to load credentials');
    }
};

/**
 * Saves credentials to storage
 * 
 * @param {Object} data - Credentials data
 */
const saveCredentials = async (data) => {
    try {
        await ensureCredentialsDir();
        await fs.writeFile(CREDENTIALS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        logger.error('Failed to save credentials', { error: error.message });
        throw new Error('Failed to save credentials');
    }
};

/**
 * Stores a credential securely
 * 
 * @param {string} name - Identifier for the credential
 * @param {Object} data - Credential data to store
 * @param {Object} options - Additional options
 * @param {string} options.type - Type of credential (e.g., 'api', 'oauth')
 * @param {string} options.keyId - Key identifier for encryption (for key rotation)
 * @returns {Object} Status of the operation
 */
const storeCredential = async (name, data, options = {}) => {
    if (!name || typeof name !== 'string') {
        throw new Error('Credential name is required');
    }

    if (!data) {
        throw new Error('Credential data is required');
    }

    try {
        const credentialsData = await loadCredentials();
        const keyId = options.keyId || credentialsData.meta.keyId || 'v1';

        // Encrypt the credential data
        const encryptedData = encrypt(data, MASTER_KEY, keyId);

        // Store with metadata
        credentialsData.credentials[name] = {
            encrypted: encryptedData,
            type: options.type || 'generic',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await saveCredentials(credentialsData);

        return {
            success: true,
            name,
            message: `Credential "${name}" stored successfully`
        };
    } catch (error) {
        logger.error('Failed to store credential', { name, error: error.message });
        throw new Error(`Failed to store credential "${name}": ${error.message}`);
    }
};

/**
 * Retrieves a stored credential
 * 
 * @param {string} name - Name of the credential to retrieve
 * @returns {Object} Decrypted credential data
 */
const getCredential = async (name) => {
    if (!name || typeof name !== 'string') {
        throw new Error('Credential name is required');
    }

    try {
        const credentialsData = await loadCredentials();

        if (!credentialsData.credentials[name]) {
            throw new Error(`Credential "${name}" not found`);
        }

        const encryptedData = credentialsData.credentials[name].encrypted;

        // Decrypt the credential data
        const decryptedData = decrypt(encryptedData, MASTER_KEY);

        return {
            data: decryptedData,
            type: credentialsData.credentials[name].type,
            createdAt: credentialsData.credentials[name].createdAt,
            updatedAt: credentialsData.credentials[name].updatedAt
        };
    } catch (error) {
        logger.error('Failed to retrieve credential', { name, error: error.message });
        throw new Error(`Failed to retrieve credential "${name}": ${error.message}`);
    }
};

/**
 * Updates a stored credential
 * 
 * @param {string} name - Name of the credential to update
 * @param {Object} data - New credential data
 * @param {Object} options - Additional options
 * @returns {Object} Status of the operation
 */
const updateCredential = async (name, data, options = {}) => {
    if (!name || typeof name !== 'string') {
        throw new Error('Credential name is required');
    }

    if (!data) {
        throw new Error('Credential data is required');
    }

    try {
        const credentialsData = await loadCredentials();

        if (!credentialsData.credentials[name]) {
            throw new Error(`Credential "${name}" not found`);
        }

        const keyId = options.keyId || credentialsData.meta.keyId || 'v1';

        // Encrypt the credential data
        const encryptedData = encrypt(data, MASTER_KEY, keyId);

        // Update the credential
        credentialsData.credentials[name] = {
            ...credentialsData.credentials[name],
            encrypted: encryptedData,
            updatedAt: new Date().toISOString()
        };

        // Update type if provided
        if (options.type) {
            credentialsData.credentials[name].type = options.type;
        }

        await saveCredentials(credentialsData);

        return {
            success: true,
            name,
            message: `Credential "${name}" updated successfully`
        };
    } catch (error) {
        logger.error('Failed to update credential', { name, error: error.message });
        throw new Error(`Failed to update credential "${name}": ${error.message}`);
    }
};

/**
 * Deletes a stored credential
 * 
 * @param {string} name - Name of the credential to delete
 * @returns {Object} Status of the operation
 */
const deleteCredential = async (name) => {
    if (!name || typeof name !== 'string') {
        throw new Error('Credential name is required');
    }

    try {
        const credentialsData = await loadCredentials();

        if (!credentialsData.credentials[name]) {
            throw new Error(`Credential "${name}" not found`);
        }

        // Delete the credential
        delete credentialsData.credentials[name];

        await saveCredentials(credentialsData);

        return {
            success: true,
            name,
            message: `Credential "${name}" deleted successfully`
        };
    } catch (error) {
        logger.error('Failed to delete credential', { name, error: error.message });
        throw new Error(`Failed to delete credential "${name}": ${error.message}`);
    }
};

/**
 * Lists all available credentials (without sensitive data)
 * 
 * @returns {Object[]} List of credentials with metadata
 */
const listCredentials = async () => {
    try {
        const credentialsData = await loadCredentials();

        return Object.entries(credentialsData.credentials).map(([name, cred]) => ({
            name,
            type: cred.type,
            createdAt: cred.createdAt,
            updatedAt: cred.updatedAt
        }));
    } catch (error) {
        logger.error('Failed to list credentials', { error: error.message });
        throw new Error('Failed to list credentials');
    }
};

/**
 * Rotates the encryption key for all credentials
 * 
 * @param {string} newKeyId - New key identifier
 * @returns {Object} Status of the operation
 */
const rotateEncryptionKey = async (newKeyId = `v${Date.now()}`) => {
    try {
        const credentialsData = await loadCredentials();
        const currentKeyId = credentialsData.meta.keyId || 'v1';

        // Skip if key ID is the same
        if (newKeyId === currentKeyId) {
            return {
                success: true,
                message: 'Key already up to date, no rotation needed',
                keyId: currentKeyId
            };
        }

        // Re-encrypt all credentials with the new key ID
        for (const [name, cred] of Object.entries(credentialsData.credentials)) {
            try {
                // Decrypt with current key
                const decryptedData = decrypt(cred.encrypted, MASTER_KEY);

                // Re-encrypt with new key ID
                cred.encrypted = encrypt(decryptedData, MASTER_KEY, newKeyId);
                cred.updatedAt = new Date().toISOString();
            } catch (error) {
                logger.error(`Failed to rotate key for credential "${name}"`, { error: error.message });
                // Continue with other credentials
            }
        }

        // Update metadata
        credentialsData.meta.keyId = newKeyId;
        credentialsData.meta.keyRotatedAt = new Date().toISOString();

        await saveCredentials(credentialsData);

        return {
            success: true,
            message: `Encryption key rotated successfully to "${newKeyId}"`,
            keyId: newKeyId
        };
    } catch (error) {
        logger.error('Failed to rotate encryption key', { error: error.message });
        throw new Error('Failed to rotate encryption key');
    }
};

// Initialize credentials storage on module load
(async () => {
    try {
        await initCredentialsStorage();
    } catch (error) {
        logger.error('Failed to initialize credentials storage', { error: error.message });
    }
})();

module.exports = {
    storeCredential,
    getCredential,
    updateCredential,
    deleteCredential,
    listCredentials,
    rotateEncryptionKey
}; 