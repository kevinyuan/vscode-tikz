/**
 * Represents a cached SVG diagram entry with metadata for cache management.
 * 
 * This class stores rendered SVG diagrams along with metadata used for
 * cache expiration and access tracking.
 */
export class CacheEntry {
    /**
     * Content hash of the tikz source code (cache key)
     */
    hash: string;

    /**
     * Rendered SVG string
     */
    svg: string;

    /**
     * Timestamp when the entry was created (milliseconds since epoch)
     */
    timestamp: number;

    /**
     * Number of times this cache entry has been accessed
     */
    accessCount: number;

    /**
     * Creates a new cache entry.
     * 
     * @param hash - Content hash of the tikz source code
     * @param svg - Rendered SVG string
     * @param timestamp - Creation timestamp (defaults to current time)
     * @param accessCount - Initial access count (defaults to 0)
     */
    constructor(
        hash: string,
        svg: string,
        timestamp: number = Date.now(),
        accessCount: number = 0
    ) {
        this.hash = hash;
        this.svg = svg;
        this.timestamp = timestamp;
        this.accessCount = accessCount;
    }

    /**
     * Checks if the cache entry has expired based on a maximum age.
     * 
     * @param maxAge - Maximum age in milliseconds
     * @returns true if the entry is older than maxAge, false otherwise
     */
    isExpired(maxAge: number): boolean {
        return Date.now() - this.timestamp > maxAge;
    }

    /**
     * Increments the access count for this cache entry.
     * This is used to track cache entry usage for potential LRU eviction.
     */
    touch(): void {
        this.accessCount++;
    }
}
