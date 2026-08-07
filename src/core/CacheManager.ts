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
    private static readonly MAX_PERSISTENT_ENTRIES = 128;

    private globalState: vscode.Memento;

    /**
     * Access counts held in memory.
     *
     * Persisting these on every read would mean a `globalState` write — i.e. a
     * `state.vscdb` write of the whole SVG payload — for every cache *hit*, on
     * every render pass. The count is only bookkeeping, so it is kept in memory
     * and flushed opportunistically when the entry is written anyway.
     */
    private readonly accessCounts = new Map<string, number>();

    /** In-memory mirror of the persisted index, to avoid re-reading it per operation. */
    private index: string[] | null = null;

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
     * Read-only with respect to storage: the access count is tracked in memory.
     *
     * @param hash - Content hash of the tikz source code
     * @returns The cached diagram entry, or undefined if not found
     *
     * **Validates: Requirement 6.2**
     */
    async get(hash: string): Promise<CacheEntry | undefined> {
        const data = this.read(hash);
        if (!data) {
            return undefined;
        }

        const accessCount = (this.accessCounts.get(hash) ?? data.accessCount) + 1;
        this.accessCounts.set(hash, accessCount);

        return new CacheEntry(data.hash, data.svg, data.timestamp, accessCount);
    }

    /** Raw storage read with no access-count side effect. */
    private read(hash: string): {
        hash: string;
        svg: string;
        timestamp: number;
        accessCount: number;
    } | undefined {
        return this.globalState.get(this.getCacheKey(hash));
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

        // Flush any in-memory access count now that we're writing anyway.
        const accessCount = Math.max(diagram.accessCount, this.accessCounts.get(hash) ?? 0);
        this.accessCounts.set(hash, accessCount);

        // Store the cache entry
        await this.globalState.update(key, {
            hash: diagram.hash,
            svg: diagram.svg,
            timestamp: diagram.timestamp,
            accessCount
        });

        // Update the cache index and evict oldest if over capacity
        await this.addToIndex(hash);
        await this.evictIfNeeded();
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
        this.accessCounts.delete(hash);
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
        this.accessCounts.clear();
        this.index = [];
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
            const data = this.read(hash);
            if (data) {
                // Approximate size: SVG string length + metadata overhead
                totalSize += data.svg.length + 100;
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
        if (this.index === null) {
            this.index = this.globalState.get<string[]>(CacheManager.CACHE_INDEX_KEY) || [];
        }
        return this.index;
    }

    /** Persist the index and keep the in-memory mirror in sync. */
    private async writeIndex(index: string[]): Promise<void> {
        this.index = index;
        await this.globalState.update(CacheManager.CACHE_INDEX_KEY, index);
    }

    /**
     * Adds a hash to the cache index.
     *
     * @param hash - Hash to add to the index
     */
    private async addToIndex(hash: string): Promise<void> {
        const index = await this.getIndex();
        if (!index.includes(hash)) {
            await this.writeIndex([...index, hash]);
        }
    }

    /**
     * Removes a hash from the cache index.
     *
     * @param hash - Hash to remove from the index
     */
    private async removeFromIndex(hash: string): Promise<void> {
        const index = await this.getIndex();
        if (!index.includes(hash)) { return; }
        await this.writeIndex(index.filter(h => h !== hash));
    }

    /**
     * Evicts the oldest entries when the cache exceeds MAX_PERSISTENT_ENTRIES.
     * The index is ordered by insertion time, so oldest entries are at the front.
     */
    private async evictIfNeeded(): Promise<void> {
        const index = await this.getIndex();
        if (index.length <= CacheManager.MAX_PERSISTENT_ENTRIES) { return; }

        const toEvict = index.slice(0, index.length - CacheManager.MAX_PERSISTENT_ENTRIES);
        for (const hash of toEvict) {
            const key = this.getCacheKey(hash);
            this.accessCounts.delete(hash);
            await this.globalState.update(key, undefined);
        }

        await this.writeIndex(index.slice(index.length - CacheManager.MAX_PERSISTENT_ENTRIES));
    }
}
