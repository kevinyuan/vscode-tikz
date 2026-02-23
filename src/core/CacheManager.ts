import * as vscode from 'vscode';
import { CacheEntry } from './CacheEntry';

/**
 * Statistics about the cache state
 */
export interface CacheStats {
    /** Number of entries in the cache */
    entryCount: number;
    /** Total size of cached data in bytes (approximate) */
    totalSize: number;
}

/**
 * Manages caching of rendered SVG diagrams using VS Code's global state.
 * 
 * The CacheManager stores rendered SVG diagrams by their content hash,
 * allowing quick retrieval without re-rendering. It uses VS Code's
 * ExtensionContext.globalState for persistent storage across sessions.
 * 
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
 */
export class CacheManager {
    private static readonly CACHE_KEY_PREFIX = 'tikzjax.cache.';
    private static readonly CACHE_INDEX_KEY = 'tikzjax.cache.index';

    private globalState: vscode.Memento;

    /**
     * Creates a new CacheManager instance.
     * 
     * @param globalState - VS Code's global state storage
     */
    constructor(globalState: vscode.Memento) {
        this.globalState = globalState;
    }

    /**
     * Retrieves a cached diagram by its content hash.
     * 
     * @param hash - Content hash of the tikz source code
     * @returns The cached diagram entry, or undefined if not found
     * 
     * **Validates: Requirement 6.2**
     */
    async get(hash: string): Promise<CacheEntry | undefined> {
        const key = this.getCacheKey(hash);
        const data = this.globalState.get<{
            hash: string;
            svg: string;
            timestamp: number;
            accessCount: number;
        }>(key);

        if (!data) {
            return undefined;
        }

        const entry = new CacheEntry(
            data.hash,
            data.svg,
            data.timestamp,
            data.accessCount
        );

        // Touch the entry to track access
        entry.touch();

        // Update the access count in storage
        await this.globalState.update(key, {
            hash: entry.hash,
            svg: entry.svg,
            timestamp: entry.timestamp,
            accessCount: entry.accessCount
        });

        return entry;
    }

    /**
     * Stores a rendered diagram in the cache.
     * 
     * @param hash - Content hash of the tikz source code
     * @param diagram - The cache entry to store
     * 
     * **Validates: Requirement 6.1**
     */
    async set(hash: string, diagram: CacheEntry): Promise<void> {
        const key = this.getCacheKey(hash);

        // Store the cache entry
        await this.globalState.update(key, {
            hash: diagram.hash,
            svg: diagram.svg,
            timestamp: diagram.timestamp,
            accessCount: diagram.accessCount
        });

        // Update the cache index
        await this.addToIndex(hash);
    }

    /**
     * Invalidates (removes) a cache entry by its hash.
     * 
     * @param hash - Content hash of the tikz source code to invalidate
     * 
     * **Validates: Requirement 6.3**
     */
    async invalidate(hash: string): Promise<void> {
        const key = this.getCacheKey(hash);
        await this.globalState.update(key, undefined);
        await this.removeFromIndex(hash);
    }

    /**
     * Clears all cached diagrams.
     * 
     * **Validates: Requirement 6.4**
     */
    async clear(): Promise<void> {
        const index = await this.getIndex();

        // Remove all cache entries
        for (const hash of index) {
            const key = this.getCacheKey(hash);
            await this.globalState.update(key, undefined);
        }

        // Clear the index
        await this.globalState.update(CacheManager.CACHE_INDEX_KEY, undefined);
    }

    /**
     * Gets statistics about the current cache state.
     * 
     * @returns Cache statistics including entry count and total size
     */
    async getStats(): Promise<CacheStats> {
        const index = await this.getIndex();
        let totalSize = 0;

        for (const hash of index) {
            const entry = await this.get(hash);
            if (entry) {
                // Approximate size: SVG string length + metadata overhead
                totalSize += entry.svg.length + 100;
            }
        }

        return {
            entryCount: index.length,
            totalSize
        };
    }

    /**
     * Gets the cache key for a given hash.
     * 
     * @param hash - Content hash
     * @returns Full cache key for storage
     */
    private getCacheKey(hash: string): string {
        return `${CacheManager.CACHE_KEY_PREFIX}${hash}`;
    }

    /**
     * Gets the list of all cached hashes from the index.
     * 
     * @returns Array of cached hashes
     */
    private async getIndex(): Promise<string[]> {
        return this.globalState.get<string[]>(CacheManager.CACHE_INDEX_KEY) || [];
    }

    /**
     * Adds a hash to the cache index.
     * 
     * @param hash - Hash to add to the index
     */
    private async addToIndex(hash: string): Promise<void> {
        const index = await this.getIndex();
        if (!index.includes(hash)) {
            index.push(hash);
            await this.globalState.update(CacheManager.CACHE_INDEX_KEY, index);
        }
    }

    /**
     * Removes a hash from the cache index.
     * 
     * @param hash - Hash to remove from the index
     */
    private async removeFromIndex(hash: string): Promise<void> {
        const index = await this.getIndex();
        const newIndex = index.filter(h => h !== hash);
        await this.globalState.update(CacheManager.CACHE_INDEX_KEY, newIndex);
    }
}
