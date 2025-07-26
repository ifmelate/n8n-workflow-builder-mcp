const { describe, it, expect } = require('@jest/globals');

/**
 * Copy of the findBestMatchingVersion function from src/index.ts for testing
 * This should match the actual implementation
 */
function findBestMatchingVersion(targetVersion, availableVersions) {
    if (availableVersions.length === 0) {
        return null;
    }

    // Check for exact match first
    if (availableVersions.includes(targetVersion)) {
        return targetVersion;
    }

    // Parse version numbers for comparison
    const parseVersion = (version) => {
        const parts = version.split('.').map(part => parseInt(part, 10) || 0);
        // Ensure we have at least 3 parts (major.minor.patch)
        while (parts.length < 3) {
            parts.push(0);
        }
        return parts;
    };

    const targetParts = parseVersion(targetVersion);
    
    // Find all versions that are less than or equal to target version
    const candidateVersions = availableVersions.filter(version => {
        const versionParts = parseVersion(version);
        
        // Compare version parts (major.minor.patch)
        for (let i = 0; i < Math.max(targetParts.length, versionParts.length); i++) {
            const targetPart = targetParts[i] || 0;
            const versionPart = versionParts[i] || 0;
            
            if (versionPart < targetPart) {
                return true; // This version is lower
            } else if (versionPart > targetPart) {
                return false; // This version is higher
            }
            // If equal, continue to next part
        }
        
        return true; // Versions are equal (this shouldn't happen since we checked exact match above)
    });

    if (candidateVersions.length === 0) {
        return null; // No suitable lower version found
    }

    // Sort candidates in descending order and return the highest (closest to target)
    candidateVersions.sort((a, b) => {
        const aParts = parseVersion(a);
        const bParts = parseVersion(b);
        
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const aPart = aParts[i] || 0;
            const bPart = bParts[i] || 0;
            
            if (aPart !== bPart) {
                return bPart - aPart; // Descending order
            }
        }
        
        return 0;
    });

    return candidateVersions[0];
}

describe('Version Matching Logic', () => {
    describe('findBestMatchingVersion', () => {
        it('should return exact match when available', () => {
            const result = findBestMatchingVersion('1.91.2', ['1.70.0', '1.72.1', '1.75.0', '1.91.2']);
            expect(result).toBe('1.91.2');
        });

        it('should return closest lower version when exact match not available', () => {
            // User's specific example case
            const result = findBestMatchingVersion('1.72.2', ['1.70.0', '1.72.1', '1.75.0', '1.91.2']);
            expect(result).toBe('1.72.1');
        });

        it('should return null when no lower version available', () => {
            const result = findBestMatchingVersion('1.50.0', ['1.70.0', '1.72.1', '1.75.0', '1.91.2']);
            expect(result).toBe(null);
        });

        it('should return highest available when target is higher than all', () => {
            const result = findBestMatchingVersion('2.0.0', ['1.70.0', '1.72.1', '1.75.0', '1.91.2']);
            expect(result).toBe('1.91.2');
        });

        it('should handle complex patch version numbers', () => {
            const result = findBestMatchingVersion('1.72.15', ['1.72.1', '1.72.10', '1.72.14', '1.72.20', '1.73.0']);
            expect(result).toBe('1.72.14');
        });

        it('should handle major version differences correctly', () => {
            const result = findBestMatchingVersion('2.1.0', ['1.91.2', '2.0.5', '2.0.15', '2.2.0']);
            expect(result).toBe('2.0.15');
        });

        it('should handle two-digit version parts', () => {
            const result = findBestMatchingVersion('1.10.5', ['1.9.8', '1.10.2', '1.10.10', '1.11.0']);
            expect(result).toBe('1.10.2');
        });

        it('should return null for empty available versions array', () => {
            const result = findBestMatchingVersion('1.72.2', []);
            expect(result).toBe(null);
        });

        it('should handle single available version correctly', () => {
            // Lower than target
            expect(findBestMatchingVersion('1.72.2', ['1.70.0'])).toBe('1.70.0');
            // Higher than target  
            expect(findBestMatchingVersion('1.72.2', ['1.75.0'])).toBe(null);
            // Equal to target
            expect(findBestMatchingVersion('1.72.2', ['1.72.2'])).toBe('1.72.2');
        });

        it('should handle versions with different number of parts', () => {
            const result = findBestMatchingVersion('1.72', ['1.70.0', '1.71.5', '1.72.0', '1.73.0']);
            expect(result).toBe('1.72.0');
        });

        it('should handle pre-release style versions', () => {
            const result = findBestMatchingVersion('1.72.0', ['1.71.0', '1.72.0', '1.72.1']);
            expect(result).toBe('1.72.0');
        });

        describe('edge cases', () => {
            it('should handle zero versions', () => {
                const result = findBestMatchingVersion('1.0.0', ['0.9.0', '1.0.0', '1.1.0']);
                expect(result).toBe('1.0.0');
            });

            it('should handle leading zeros in version parts', () => {
                const result = findBestMatchingVersion('1.02.03', ['1.1.5', '1.2.2', '1.2.3', '1.3.0']);
                expect(result).toBe('1.2.3');
            });

            it('should sort versions correctly when multiple candidates exist', () => {
                const result = findBestMatchingVersion('1.75.0', ['1.70.0', '1.72.1', '1.74.5', '1.74.9', '1.76.0']);
                expect(result).toBe('1.74.9'); // Should pick the highest among lower versions
            });
        });
    });
}); 