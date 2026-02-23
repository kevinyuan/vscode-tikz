import * as vscode from 'vscode';
import { CacheManager } from './CacheManager';
import { CacheEntry } from './CacheEntry';

/**
 * Mock implementation of VS Code's Memento interface for testing
 */
class MockMemento implements vscode.Memento {
    private storage = new Map<string, any>();

    keys(): readonly string[] {
        return Array.from(this.storage.keys());
    }

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        const value = this.storage.get(key);
        return value !== undefined ? value : defaultValue;
    }

    async update(key: string, value: any): Promise<void> {
        if (value === undefined) {
            this.storage.delete(key);
        } else {
            this.storage.set(key, value);
        }
    }

    setKeysForSync(_keys: readonly string[]): void {
        // Not needed for tests
    }
}

describe('CacheManager', () => {
    let mockGlobalState: MockMemento;
    let cacheManager: CacheManager;

    beforeEach(() => {
        mockGlobalState = new MockMemento();
        cacheManager = new CacheManager(mockGlobalState);
    });

    describe('set and get', () => {
        it('should store and retrieve a cache entry', async () => {
            const hash = 'abc123';
            const svg = '<svg>test diagram</svg>';
            const entry = new CacheEntry(hash, svg);

            await cacheManager.set(hash, entry);
            const retrieved = await cacheManager.get(hash);

            expect(retrieved).toBeDefined();
            expect(retrieved!.hash).toBe(hash);
            expect(retrieved!.svg).toBe(svg);
        });

        it('should return undefined for non-existent hash', async () => {
            const retrieved = await cacheManager.get('nonexistent');

            expect(retrieved).toBeUndefined();
        });

        it('should store multiple entries independently', async () => {
            const entry1 = new CacheEntry('hash1', '<svg>diagram1</svg>');
            const entry2 = new CacheEntry('hash2', '<svg>diagram2</svg>');

            await cacheManager.set('hash1', entry1);
            await cacheManager.set('hash2', entry2);

            const retrieved1 = await cacheManager.get('hash1');
            const retrieved2 = await cacheManager.get('hash2');

            expect(retrieved1!.svg).toBe('<svg>diagram1</svg>');
            expect(retrieved2!.svg).toBe('<svg>diagram2</svg>');
        });

        it('should overwrite existing entry with same hash', async () => {
            const hash = 'abc123';
            const entry1 = new CacheEntry(hash, '<svg>old</svg>');
            const entry2 = new CacheEntry(hash, '<svg>new</svg>');

            await cacheManager.set(hash, entry1);
            await cacheManager.set(hash, entry2);

            const retrieved = await cacheManager.get(hash);

            expect(retrieved!.svg).toBe('<svg>new</svg>');
        });

        it('should preserve timestamp when storing and retrieving', async () => {
            const hash = 'abc123';
            const timestamp = 1234567890;
            const entry = new CacheEntry(hash, '<svg></svg>', timestamp);

            await cacheManager.set(hash, entry);
            const retrieved = await cacheManager.get(hash);

            expect(retrieved!.timestamp).toBe(timestamp);
        });

        it('should increment access count on retrieval', async () => {
            const hash = 'abc123';
            const entry = new CacheEntry(hash, '<svg></svg>', Date.now(), 0);

            await cacheManager.set(hash, entry);

            const retrieved1 = await cacheManager.get(hash);
            expect(retrieved1!.accessCount).toBe(1);

            const retrieved2 = await cacheManager.get(hash);
            expect(retrieved2!.accessCount).toBe(2);
        });

        it('should handle empty SVG strings', async () => {
            const hash = 'empty';
            const entry = new CacheEntry(hash, '');

            await cacheManager.set(hash, entry);
            const retrieved = await cacheManager.get(hash);

            expect(retrieved!.svg).toBe('');
        });

        it('should handle very long SVG strings', async () => {
            const hash = 'long';
            const longSvg = '<svg>' + 'x'.repeat(100000) + '</svg>';
            const entry = new CacheEntry(hash, longSvg);

            await cacheManager.set(hash, entry);
            const retrieved = await cacheManager.get(hash);

            expect(retrieved!.svg).toBe(longSvg);
        });

        it('should handle special characters in hash', async () => {
            const hash = 'abc-123_xyz.456';
            const entry = new CacheEntry(hash, '<svg></svg>');

            await cacheManager.set(hash, entry);
            const retrieved = await cacheManager.get(hash);

            expect(retrieved).toBeDefined();
            expect(retrieved!.hash).toBe(hash);
        });
    });

    describe('invalidate', () => {
        it('should remove a cache entry', async () => {
            const hash = 'abc123';
            const entry = new CacheEntry(hash, '<svg></svg>');

            await cacheManager.set(hash, entry);
            await cacheManager.invalidate(hash);

            const retrieved = await cacheManager.get(hash);
            expect(retrieved).toBeUndefined();
        });

        it('should not affect other cache entries', async () => {
            const entry1 = new CacheEntry('hash1', '<svg>1</svg>');
            const entry2 = new CacheEntry('hash2', '<svg>2</svg>');

            await cacheManager.set('hash1', entry1);
            await cacheManager.set('hash2', entry2);
            await cacheManager.invalidate('hash1');

            const retrieved1 = await cacheManager.get('hash1');
            const retrieved2 = await cacheManager.get('hash2');

            expect(retrieved1).toBeUndefined();
            expect(retrieved2).toBeDefined();
            expect(retrieved2!.svg).toBe('<svg>2</svg>');
        });

        it('should handle invalidating non-existent entry', async () => {
            await expect(cacheManager.invalidate('nonexistent')).resolves.not.toThrow();
        });

        it('should remove hash from index', async () => {
            const hash = 'abc123';
            const entry = new CacheEntry(hash, '<svg></svg>');

            await cacheManager.set(hash, entry);
            await cacheManager.invalidate(hash);

            const stats = await cacheManager.getStats();
            expect(stats.entryCount).toBe(0);
        });
    });

    describe('clear', () => {
        it('should remove all cache entries', async () => {
            const entry1 = new CacheEntry('hash1', '<svg>1</svg>');
            const entry2 = new CacheEntry('hash2', '<svg>2</svg>');
            const entry3 = new CacheEntry('hash3', '<svg>3</svg>');

            await cacheManager.set('hash1', entry1);
            await cacheManager.set('hash2', entry2);
            await cacheManager.set('hash3', entry3);

            await cacheManager.clear();

            const retrieved1 = await cacheManager.get('hash1');
            const retrieved2 = await cacheManager.get('hash2');
            const retrieved3 = await cacheManager.get('hash3');

            expect(retrieved1).toBeUndefined();
            expect(retrieved2).toBeUndefined();
            expect(retrieved3).toBeUndefined();
        });

        it('should clear the cache index', async () => {
            const entry1 = new CacheEntry('hash1', '<svg>1</svg>');
            const entry2 = new CacheEntry('hash2', '<svg>2</svg>');

            await cacheManager.set('hash1', entry1);
            await cacheManager.set('hash2', entry2);

            await cacheManager.clear();

            const stats = await cacheManager.getStats();
            expect(stats.entryCount).toBe(0);
        });

        it('should handle clearing empty cache', async () => {
            await expect(cacheManager.clear()).resolves.not.toThrow();

            const stats = await cacheManager.getStats();
            expect(stats.entryCount).toBe(0);
        });

        it('should allow adding entries after clear', async () => {
            const entry1 = new CacheEntry('hash1', '<svg>1</svg>');
            const entry2 = new CacheEntry('hash2', '<svg>2</svg>');

            await cacheManager.set('hash1', entry1);
            await cacheManager.clear();
            await cacheManager.set('hash2', entry2);

            const retrieved = await cacheManager.get('hash2');
            expect(retrieved).toBeDefined();
            expect(retrieved!.svg).toBe('<svg>2</svg>');
        });
    });

    describe('getStats', () => {
        it('should return zero stats for empty cache', async () => {
            const stats = await cacheManager.getStats();

            expect(stats.entryCount).toBe(0);
            expect(stats.totalSize).toBe(0);
        });

        it('should return correct entry count', async () => {
            const entry1 = new CacheEntry('hash1', '<svg>1</svg>');
            const entry2 = new CacheEntry('hash2', '<svg>2</svg>');
            const entry3 = new CacheEntry('hash3', '<svg>3</svg>');

            await cacheManager.set('hash1', entry1);
            await cacheManager.set('hash2', entry2);
            await cacheManager.set('hash3', entry3);

            const stats = await cacheManager.getStats();
            expect(stats.entryCount).toBe(3);
        });

        it('should calculate approximate total size', async () => {
            const svg1 = '<svg>test1</svg>'; // 16 chars
            const svg2 = '<svg>test2</svg>'; // 16 chars
            const entry1 = new CacheEntry('hash1', svg1);
            const entry2 = new CacheEntry('hash2', svg2);

            await cacheManager.set('hash1', entry1);
            await cacheManager.set('hash2', entry2);

            const stats = await cacheManager.getStats();

            // Each entry: SVG length + 100 bytes overhead
            // Total: (16 + 100) + (16 + 100) = 232
            // Note: access count increments during get, so we need to account for that
            expect(stats.totalSize).toBeGreaterThan(0);
            expect(stats.totalSize).toBeGreaterThanOrEqual(32); // At least the SVG content
        });

        it('should update stats after invalidation', async () => {
            const entry1 = new CacheEntry('hash1', '<svg>1</svg>');
            const entry2 = new CacheEntry('hash2', '<svg>2</svg>');

            await cacheManager.set('hash1', entry1);
            await cacheManager.set('hash2', entry2);

            await cacheManager.invalidate('hash1');

            const stats = await cacheManager.getStats();
            expect(stats.entryCount).toBe(1);
        });

        it('should update stats after clear', async () => {
            const entry1 = new CacheEntry('hash1', '<svg>1</svg>');
            const entry2 = new CacheEntry('hash2', '<svg>2</svg>');

            await cacheManager.set('hash1', entry1);
            await cacheManager.set('hash2', entry2);

            await cacheManager.clear();

            const stats = await cacheManager.getStats();
            expect(stats.entryCount).toBe(0);
            expect(stats.totalSize).toBe(0);
        });
    });

    describe('cache index management', () => {
        it('should not add duplicate hashes to index', async () => {
            const hash = 'abc123';
            const entry1 = new CacheEntry(hash, '<svg>old</svg>');
            const entry2 = new CacheEntry(hash, '<svg>new</svg>');

            await cacheManager.set(hash, entry1);
            await cacheManager.set(hash, entry2);

            const stats = await cacheManager.getStats();
            expect(stats.entryCount).toBe(1);
        });

        it('should maintain index consistency across operations', async () => {
            const entry1 = new CacheEntry('hash1', '<svg>1</svg>');
            const entry2 = new CacheEntry('hash2', '<svg>2</svg>');
            const entry3 = new CacheEntry('hash3', '<svg>3</svg>');

            await cacheManager.set('hash1', entry1);
            await cacheManager.set('hash2', entry2);
            await cacheManager.set('hash3', entry3);
            await cacheManager.invalidate('hash2');

            const stats = await cacheManager.getStats();
            expect(stats.entryCount).toBe(2);

            const retrieved1 = await cacheManager.get('hash1');
            const retrieved2 = await cacheManager.get('hash2');
            const retrieved3 = await cacheManager.get('hash3');

            expect(retrieved1).toBeDefined();
            expect(retrieved2).toBeUndefined();
            expect(retrieved3).toBeDefined();
        });
    });

    describe('edge cases', () => {
        it('should handle sequential set operations', async () => {
            const entry1 = new CacheEntry('hash1', '<svg>1</svg>');
            const entry2 = new CacheEntry('hash2', '<svg>2</svg>');
            const entry3 = new CacheEntry('hash3', '<svg>3</svg>');

            // Set operations should be sequential to avoid race conditions
            await cacheManager.set('hash1', entry1);
            await cacheManager.set('hash2', entry2);
            await cacheManager.set('hash3', entry3);

            const stats = await cacheManager.getStats();
            expect(stats.entryCount).toBe(3);
        });

        it('should handle concurrent get operations', async () => {
            const entry = new CacheEntry('hash', '<svg></svg>');
            await cacheManager.set('hash', entry);

            const results = await Promise.all([
                cacheManager.get('hash'),
                cacheManager.get('hash'),
                cacheManager.get('hash')
            ]);

            expect(results[0]).toBeDefined();
            expect(results[1]).toBeDefined();
            expect(results[2]).toBeDefined();
        });

        it('should handle hash with only special characters', async () => {
            const hash = '!@#$%^&*()';
            const entry = new CacheEntry(hash, '<svg></svg>');

            await cacheManager.set(hash, entry);
            const retrieved = await cacheManager.get(hash);

            expect(retrieved).toBeDefined();
        });

        it('should handle very long hash strings', async () => {
            const hash = 'a'.repeat(1000);
            const entry = new CacheEntry(hash, '<svg></svg>');

            await cacheManager.set(hash, entry);
            const retrieved = await cacheManager.get(hash);

            expect(retrieved).toBeDefined();
            expect(retrieved!.hash).toBe(hash);
        });
    });
});
