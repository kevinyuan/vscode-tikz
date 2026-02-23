import { generateHash, generateShortHash } from './hash';
import * as fc from 'fast-check';

describe('generateHash', () => {
    // Unit tests for specific examples
    test('generates consistent hash for same input', () => {
        const source = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
        const hash1 = generateHash(source);
        const hash2 = generateHash(source);
        expect(hash1).toBe(hash2);
    });

    test('generates different hash for different inputs', () => {
        const source1 = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
        const source2 = '\\begin{tikzpicture}\n\\draw (0,0) -- (2,2);\n\\end{tikzpicture}';
        const hash1 = generateHash(source1);
        const hash2 = generateHash(source2);
        expect(hash1).not.toBe(hash2);
    });

    test('generates hash for empty string', () => {
        const hash = generateHash('');
        expect(hash).toBeDefined();
        expect(hash.length).toBeGreaterThan(0);
    });

    test('generates different hash when single character changes', () => {
        const source1 = 'test';
        const source2 = 'Test';
        const hash1 = generateHash(source1);
        const hash2 = generateHash(source2);
        expect(hash1).not.toBe(hash2);
    });

    // Property-based test for Content Hash Stability
    describe('Property 2: Content Hash Stability', () => {
        test('hash is stable - same input produces same hash', () => {
            fc.assert(
                fc.property(fc.string(), (source) => {
                    const hash1 = generateHash(source);
                    const hash2 = generateHash(source);
                    return hash1 === hash2;
                }),
                { numRuns: 100 }
            );
        });

        test('hash changes when content changes - modifying any character produces different hash', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1 }),
                    fc.integer({ min: 0 }),
                    fc.string({ minLength: 1, maxLength: 1 }),
                    (source, position, newChar) => {
                        // Ensure position is within bounds
                        const pos = position % source.length;

                        // Create modified string by replacing character at position
                        const modified = source.substring(0, pos) + newChar + source.substring(pos + 1);

                        // If the modification didn't actually change anything, skip this test case
                        if (modified === source) {
                            return true;
                        }

                        const originalHash = generateHash(source);
                        const modifiedHash = generateHash(modified);

                        return originalHash !== modifiedHash;
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('hash changes when appending any character', () => {
            fc.assert(
                fc.property(
                    fc.string(),
                    fc.string({ minLength: 1, maxLength: 1 }),
                    (source, appendChar) => {
                        const originalHash = generateHash(source);
                        const modifiedHash = generateHash(source + appendChar);

                        return originalHash !== modifiedHash;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});

describe('generateShortHash', () => {
    test('generates 16 character hash', () => {
        const source = '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}';
        const shortHash = generateShortHash(source);
        expect(shortHash.length).toBe(16);
    });

    test('short hash is prefix of full hash', () => {
        const source = 'test source';
        const fullHash = generateHash(source);
        const shortHash = generateShortHash(source);
        expect(fullHash.startsWith(shortHash)).toBe(true);
    });

    test('generates consistent short hash for same input', () => {
        const source = 'test';
        const shortHash1 = generateShortHash(source);
        const shortHash2 = generateShortHash(source);
        expect(shortHash1).toBe(shortHash2);
    });
});
