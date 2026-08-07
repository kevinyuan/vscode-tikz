import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { CacheManager, LegacyStore } from './CacheManager';
import { CacheEntry } from './CacheEntry';

/**
 * Stand-in for the pre-0.4.39 `globalState` cache, used to exercise migration.
 */
class MockLegacyStore implements LegacyStore {
    readonly storage = new Map<string, any>();

    get<T>(key: string): T | undefined {
        return this.storage.get(key);
    }

    async update(key: string, value: any): Promise<void> {
        if (value === undefined) {
            this.storage.delete(key);
        } else {
            this.storage.set(key, value);
        }
    }
}

describe('CacheManager', () => {
    let cacheDir: string;
    let cacheManager: CacheManager;

    beforeEach(async () => {
        cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tikz-cache-test-'));
        cacheManager = new CacheManager(cacheDir);
    });

    afterEach(async () => {
        await cacheManager.dispose();
        await fsp.rm(cacheDir, { recursive: true, force: true });
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

        it('should handle a hash containing path separators', async () => {
            // Cache keys are arbitrary text; used directly they could escape the
            // cache directory entirely.
            const hash = '../../etc/passwd';
            await cacheManager.set(hash, new CacheEntry(hash, '<svg>x</svg>'));

            const retrieved = await cacheManager.get(hash);
            expect(retrieved!.svg).toBe('<svg>x</svg>');

            const written = await fsp.readdir(cacheDir);
            expect(written.every(f => !f.includes('..') && !f.includes('/'))).toBe(true);
        });

        it('should keep distinct hashes in distinct files', async () => {
            await cacheManager.set('hash1', new CacheEntry('hash1', '<svg>1</svg>'));
            await cacheManager.set('hash2', new CacheEntry('hash2', '<svg>2</svg>'));

            const svgFiles = (await fsp.readdir(cacheDir)).filter(f => f.endsWith('.svg'));
            expect(svgFiles).toHaveLength(2);
        });
    });

    describe('on-disk storage', () => {
        it('should write SVGs as files, not into a single blob', async () => {
            const svg = '<svg>persisted</svg>';
            await cacheManager.set('hash1', new CacheEntry('hash1', svg));
            await cacheManager.dispose();

            const svgFiles = (await fsp.readdir(cacheDir)).filter(f => f.endsWith('.svg'));
            expect(svgFiles).toHaveLength(1);

            const contents = await fsp.readFile(path.join(cacheDir, svgFiles[0]), 'utf8');
            expect(contents).toBe(svg);
        });

        it('should survive a restart', async () => {
            await cacheManager.set('hash1', new CacheEntry('hash1', '<svg>1</svg>', 4242));
            await cacheManager.dispose();

            const reopened = new CacheManager(cacheDir);
            const retrieved = await reopened.get('hash1');

            expect(retrieved!.svg).toBe('<svg>1</svg>');
            expect(retrieved!.timestamp).toBe(4242);
            await reopened.dispose();
        });

        it('should create the cache directory if it does not exist', async () => {
            const nested = path.join(cacheDir, 'does', 'not', 'exist');
            const manager = new CacheManager(nested);

            await manager.set('hash1', new CacheEntry('hash1', '<svg>1</svg>'));

            expect((await manager.get('hash1'))!.svg).toBe('<svg>1</svg>');
            await manager.dispose();
        });

        it('should report a miss when the SVG file is deleted behind its back', async () => {
            await cacheManager.set('hash1', new CacheEntry('hash1', '<svg>1</svg>'));

            const svgFiles = (await fsp.readdir(cacheDir)).filter(f => f.endsWith('.svg'));
            await fsp.unlink(path.join(cacheDir, svgFiles[0]));

            expect(await cacheManager.get('hash1')).toBeUndefined();
            expect((await cacheManager.getStats()).entryCount).toBe(0);
        });

        it('should recover from a corrupt index instead of throwing', async () => {
            await cacheManager.set('hash1', new CacheEntry('hash1', '<svg>1</svg>'));
            await cacheManager.dispose();
            await fsp.writeFile(path.join(cacheDir, 'index.json'), '{ not json', 'utf8');

            const reopened = new CacheManager(cacheDir);
            // The entry is unrecoverable, but the cache must still be usable.
            expect(await reopened.get('hash1')).toBeUndefined();
            await reopened.set('hash2', new CacheEntry('hash2', '<svg>2</svg>'));
            expect((await reopened.get('hash2'))!.svg).toBe('<svg>2</svg>');
            await reopened.dispose();
        });

        it('should delete unreachable files left by a crash', async () => {
            // Filenames are one-way hashes of the key, so a file with no index
            // record can never be looked up again.
            await fsp.writeFile(path.join(cacheDir, 'deadbeef.svg'), '<svg>orphan</svg>', 'utf8');

            const manager = new CacheManager(cacheDir);
            await manager.getStats();

            expect(await fsp.readdir(cacheDir)).not.toContain('deadbeef.svg');
            await manager.dispose();
        });

        it('should remove files on clear, not just index rows', async () => {
            await cacheManager.set('hash1', new CacheEntry('hash1', '<svg>1</svg>'));
            await cacheManager.set('hash2', new CacheEntry('hash2', '<svg>2</svg>'));

            await cacheManager.clear();

            const svgFiles = (await fsp.readdir(cacheDir)).filter(f => f.endsWith('.svg'));
            expect(svgFiles).toHaveLength(0);
        });

        it('should remove the file on invalidate', async () => {
            await cacheManager.set('hash1', new CacheEntry('hash1', '<svg>1</svg>'));
            await cacheManager.invalidate('hash1');

            const svgFiles = (await fsp.readdir(cacheDir)).filter(f => f.endsWith('.svg'));
            expect(svgFiles).toHaveLength(0);
        });

        it('should report total size from the bytes actually stored', async () => {
            await cacheManager.set('hash1', new CacheEntry('hash1', '<svg>1</svg>'));
            await cacheManager.set('hash2', new CacheEntry('hash2', '<svg>22</svg>'));

            const stats = await cacheManager.getStats();
            expect(stats.totalSize).toBe(
                Buffer.byteLength('<svg>1</svg>') + Buffer.byteLength('<svg>22</svg>')
            );
        });
    });

    describe('migration from globalState', () => {
        const LEGACY_INDEX_KEY = 'tikzjax.cache.index';

        function seedLegacy(store: MockLegacyStore, hashes: string[]) {
            store.storage.set(LEGACY_INDEX_KEY, hashes);
            for (const hash of hashes) {
                store.storage.set(`tikzjax.cache.${hash}`, {
                    hash,
                    svg: `<svg>${hash}</svg>`,
                    timestamp: 1000,
                    accessCount: 3,
                });
            }
        }

        it('should import entries and free the old globalState keys', async () => {
            const store = new MockLegacyStore();
            seedLegacy(store, ['hash1', 'hash2']);

            const imported = await cacheManager.migrateFromMemento(store, true);

            expect(imported).toBe(2);
            expect((await cacheManager.get('hash1'))!.svg).toBe('<svg>hash1</svg>');
            expect((await cacheManager.get('hash2'))!.timestamp).toBe(1000);
            // The whole point: nothing may be left behind in globalState.
            expect(store.storage.size).toBe(0);
        });

        it('should discard entries but still free the keys when asked', async () => {
            const store = new MockLegacyStore();
            seedLegacy(store, ['hash1', 'hash2']);

            const imported = await cacheManager.migrateFromMemento(store, false);

            expect(imported).toBe(0);
            expect(await cacheManager.get('hash1')).toBeUndefined();
            expect(store.storage.size).toBe(0);
        });

        it('should be a no-op with nothing to migrate', async () => {
            const store = new MockLegacyStore();

            await expect(cacheManager.migrateFromMemento(store, true)).resolves.toBe(0);
        });

        it('should skip entries whose payload is missing', async () => {
            const store = new MockLegacyStore();
            seedLegacy(store, ['hash1', 'hash2']);
            store.storage.delete('tikzjax.cache.hash1');

            const imported = await cacheManager.migrateFromMemento(store, true);

            expect(imported).toBe(1);
            expect(store.storage.size).toBe(0);
        });
    });

    describe('eviction', () => {
        it('should evict least-recently-used entries past the entry cap', async () => {
            // MAX_ENTRIES is 2000; write past it and confirm the cap holds.
            const manager = new CacheManager(cacheDir);
            for (let i = 0; i < 2010; i++) {
                await manager.set(`hash${i}`, new CacheEntry(`hash${i}`, `<svg>${i}</svg>`));
            }

            const stats = await manager.getStats();
            expect(stats.entryCount).toBeLessThanOrEqual(2000);

            // The most recent writes survive; the oldest do not.
            expect(await manager.get('hash2009')).toBeDefined();
            expect(await manager.get('hash0')).toBeUndefined();
            await manager.dispose();
        }, 60000);

        it('should delete evicted files from disk', async () => {
            const manager = new CacheManager(cacheDir);
            for (let i = 0; i < 2010; i++) {
                await manager.set(`hash${i}`, new CacheEntry(`hash${i}`, `<svg>${i}</svg>`));
            }

            const svgFiles = (await fsp.readdir(cacheDir)).filter(f => f.endsWith('.svg'));
            expect(svgFiles.length).toBeLessThanOrEqual(2000);
            await manager.dispose();
        }, 60000);
    });
});
