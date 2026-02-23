import * as crypto from 'crypto';

/**
 * Generates a consistent hash for tikz source code.
 * Used as cache keys for rendered diagrams.
 * 
 * @param source - The tikz source code to hash
 * @returns A hexadecimal hash string
 */
export function generateHash(source: string): string {
    return crypto
        .createHash('sha256')
        .update(source, 'utf8')
        .digest('hex');
}

/**
 * Generates a short hash (first 16 characters) for display purposes.
 * 
 * @param source - The tikz source code to hash
 * @returns A shortened hexadecimal hash string
 */
export function generateShortHash(source: string): string {
    return generateHash(source).substring(0, 16);
}
