import * as crypto from 'crypto';

/**
 * Generates a consistent hash for tikz source code.
 * Used as cache keys for rendered diagrams.
 * 
 * @param source - The tikz source code to hash
 * @returns A hexadecimal hash string
 */
export function generateHash(source: string): string {
    // Normalize \r\n to \n so Windows line endings produce the same hash
    // as Unix line endings (markdown-it normalizes to \n, but VS Code
    // document.getText() preserves \r\n on Windows)
    const normalized = source.replace(/\r\n/g, '\n');
    return crypto
        .createHash('sha256')
        .update(normalized, 'utf8')
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
