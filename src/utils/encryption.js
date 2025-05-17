/**
 * Encryption Utilities
 * 
 * Provides functions for encrypting and decrypting sensitive data.
 * Uses AES-256-GCM for authenticated encryption with strong security properties.
 */

const crypto = require('crypto');
const { logger } = require('./logger');

// Encryption configuration
const ENCRYPTION_CONFIG = {
    ALGORITHM: 'aes-256-gcm',
    KEY_LENGTH: 32, // 256 bits for AES-256
    IV_LENGTH: 16,  // 128 bits
    AUTH_TAG_LENGTH: 16 // 128 bits
};

// In-memory key cache, used to support key rotation
// In production, this should be replaced with a secure key management system
const keyCache = new Map();

/**
 * Generates a random encryption key
 * 
 * @returns {Buffer} Random encryption key
 */
const generateEncryptionKey = () => {
    return crypto.randomBytes(ENCRYPTION_CONFIG.KEY_LENGTH);
};

/**
 * Derives an encryption key from a master key and a key identifier
 * This allows for key rotation by changing the key identifier
 * 
 * @param {string} masterKey - The master encryption key
 * @param {string} keyId - Key identifier (e.g., a version number)
 * @returns {Buffer} Derived encryption key
 */
const deriveKey = (masterKey, keyId) => {
    // Check if key is already in cache
    const cacheKey = `${masterKey}:${keyId}`;
    if (keyCache.has(cacheKey)) {
        return keyCache.get(cacheKey);
    }

    // Derive key using HKDF (HMAC-based Key Derivation Function)
    const derivedKey = crypto.hkdfSync(
        'sha256',
        Buffer.from(masterKey, 'hex'),
        Buffer.from(keyId, 'utf8'),
        Buffer.from('n8n-credential-encryption'),
        ENCRYPTION_CONFIG.KEY_LENGTH
    );

    // Cache the derived key
    keyCache.set(cacheKey, derivedKey);

    return derivedKey;
};

/**
 * Encrypts data using AES-256-GCM
 * 
 * @param {string|Object} data - Data to encrypt
 * @param {string} masterKey - Encryption key in hex format
 * @param {string} keyId - Key identifier for key rotation
 * @returns {string} Encrypted data as a structured string
 */
const encrypt = (data, masterKey, keyId = 'v1') => {
    try {
        // Convert data to string if it's an object
        const dataString = typeof data === 'object' ? JSON.stringify(data) : data;

        // Generate random initialization vector
        const iv = crypto.randomBytes(ENCRYPTION_CONFIG.IV_LENGTH);

        // Derive the encryption key
        const key = deriveKey(masterKey, keyId);

        // Create cipher
        const cipher = crypto.createCipheriv(ENCRYPTION_CONFIG.ALGORITHM, key, iv);

        // Encrypt the data
        let encrypted = cipher.update(dataString, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        // Get authentication tag
        const authTag = cipher.getAuthTag().toString('hex');

        // Format: VERSION:KEY_ID:IV:AUTH_TAG:ENCRYPTED_DATA
        return `1:${keyId}:${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (error) {
        logger.error('Encryption failed', { error: error.message });
        throw new Error('Failed to encrypt data');
    }
};

/**
 * Decrypts data previously encrypted with the encrypt function
 * 
 * @param {string} encryptedData - Encrypted data string
 * @param {string} masterKey - Encryption key in hex format
 * @returns {string|Object} Decrypted data
 */
const decrypt = (encryptedData, masterKey) => {
    try {
        // Parse the encrypted data
        const parts = encryptedData.split(':');

        if (parts.length !== 5) {
            throw new Error('Invalid encrypted data format');
        }

        const [version, keyId, ivHex, authTagHex, encrypted] = parts;

        // Check version
        if (version !== '1') {
            throw new Error(`Unsupported encryption version: ${version}`);
        }

        // Convert IV and auth tag from hex to Buffer
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        // Derive the key
        const key = deriveKey(masterKey, keyId);

        // Create decipher
        const decipher = crypto.createDecipheriv(ENCRYPTION_CONFIG.ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        // Decrypt the data
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        // Try to parse as JSON if possible
        try {
            return JSON.parse(decrypted);
        } catch {
            // Return as string if not valid JSON
            return decrypted;
        }
    } catch (error) {
        logger.error('Decryption failed', { error: error.message });
        throw new Error('Failed to decrypt data');
    }
};

/**
 * Generates a new encryption key in hex format
 * 
 * @returns {string} New encryption key in hex format
 */
const generateKey = () => {
    return crypto.randomBytes(ENCRYPTION_CONFIG.KEY_LENGTH).toString('hex');
};

module.exports = {
    encrypt,
    decrypt,
    generateKey,
    deriveKey
}; 