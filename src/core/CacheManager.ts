import { createHash } from 'crypto';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { CacheEntry } from './CacheEntry';

/**
 * Statistics about the cache state
 */
export interface CacheStats {
    /** Number of entries in the cache */
    entryCount: number;
    /** Total size of cached SVGs on disk, in bytes */
    totalSize: number;
}

/**
 * The subset of `vscode.Memento` needed to migrate the pre-0.4.39 cache.
 * Declared structurally so this module stays free of a `vscode` import.
 */
export interface LegacyStore {
    get<T>(key: string): T | undefined;
    update(key: string, value: any): Thenable<void>;
}

/** One row of the on-disk index. */
interface IndexRecord {
    /** Content hash of the TikZ source (the cache key). */
    hash: string;
    /** Basename of the SVG file holding this entry. */
    file: string;
    /** When the entry was first rendered. */
    timestamp: number;
    accessCount: number;
    /** When the entry was last read, used for LRU eviction. */
    lastAccess: number;
    /** Size of the SVG file in bytes. */
    size: number;
}

/**
 * Manages caching of rendered SVG diagrams as files under the extension's global
 * storage directory.
 *
 * Diagrams used to live in `globalState`, which is the wrong medium for them:
 * VS Code loads the whole of it into memory at startup and it is meant for small
 * values, so a few hundred cached SVGs became megabytes of startup cost that the
 * user never asked for. Here each SVG is a file, and only a small index is held
 * in memory.
 *
 * The index is written back on a short debounce rather than on every operation.
 * A crash inside that window is harmless: {@link loadIndex} reconciles the index
 * against the directory on load, dropping records whose file is gone and deleting
 * files no record points at.
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
 */
export class CacheManager {
    private static readonly INDEX_FILE = 'index.json';
    private static readonly SVG_EXT = '.svg';

    /** Backstops on cache growth. Eviction is least-recently-used. */
    private static readonly MAX_ENTRIES = 2000;
    private static readonly MAX_TOTAL_BYTES = 64 * 1024 * 1024;

    /** How long to batch index mutations before writing the index file. */
    private static readonly INDEX_FLUSH_DELAY_MS = 500;

    private readonly cacheDir: string;

    private index: Map<string, IndexRecord> | null = null;
    private loading: Promise<Map<string, IndexRecord>> | null = null;

    private flushTimer: ReturnType<typeof setTimeout> | undefined;
    /** Serializes index writes so a slow write can't be overtaken by a newer one. */
    private writeChain: Promise<void> = Promise.resolve();

    private tempCounter = 0;

    /**
     * @param cacheDir Directory to store cached SVGs in — typically
     *                 `<globalStorageUri>/svg-cache`. Created on first use.
     */
    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;
    }

    /**
     * Retrieves a cached diagram by its content hash.
     *
     * **Validates: Requirement 6.2**
     */
    async get(hash: string): Promise<CacheEntry | undefined> {
        const index = await this.ensureIndex();
        const record = index.get(hash);
        if (!record) { return undefined; }

        let svg: string;
        try {
            svg = await fsp.readFile(path.join(this.cacheDir, record.file), 'utf8');
        } catch {
            // File vanished underneath us — drop the stale record.
            index.delete(hash);
            this.scheduleIndexFlush();
            return undefined;
        }

        record.accessCount++;
        record.lastAccess = Date.now();
        this.scheduleIndexFlush();

        return new CacheEntry(record.hash, svg, record.timestamp, record.accessCount);
    }

    /**
     * Stores a rendered diagram in the cache.
     *
     * **Validates: Requirement 6.1**
     */
    async set(hash: string, diagram: CacheEntry): Promise<void> {
        const index = await this.ensureIndex();

        const file = CacheManager.fileNameFor(hash);
        const target = path.join(this.cacheDir, file);

        // Write to a temp file and rename, so a crash mid-write can never leave a
        // truncated SVG that would later be served as a valid cache hit.
        const temp = `${target}.${process.pid}.${this.tempCounter++}.tmp`;
        await fsp.writeFile(temp, diagram.svg, 'utf8');
        await fsp.rename(temp, target);

        const previous = index.get(hash);
        index.set(hash, {
            hash,
            file,
            timestamp: diagram.timestamp,
            accessCount: Math.max(diagram.accessCount, previous?.accessCount ?? 0),
            lastAccess: Date.now(),
            size: Buffer.byteLength(diagram.svg, 'utf8'),
        });

        await this.evictIfNeeded(index);
        this.scheduleIndexFlush();
    }

    /**
     * Invalidates (removes) a cache entry by its hash.
     *
     * **Validates: Requirement 6.3**
     */
    async invalidate(hash: string): Promise<void> {
        const index = await this.ensureIndex();
        const record = index.get(hash);
        if (!record) { return; }

        index.delete(hash);
        await this.unlinkQuietly(record.file);
        await this.flushIndex();
    }

    /**
     * Clears all cached diagrams.
     *
     * **Validates: Requirement 6.4**
     */
    async clear(): Promise<void> {
        const index = await this.ensureIndex();

        for (const record of index.values()) {
            await this.unlinkQuietly(record.file);
        }
        index.clear();

        // Sweep any file the index had lost track of, so "clear" really clears.
        for (const file of await this.listSvgFiles()) {
            await this.unlinkQuietly(file);
        }

        await this.flushIndex();
    }

    /**
     * Gets statistics about the current cache state.
     */
    async getStats(): Promise<CacheStats> {
        const index = await this.ensureIndex();
        let totalSize = 0;
        for (const record of index.values()) {
            totalSize += record.size;
        }
        return { entryCount: index.size, totalSize };
    }

    /**
     * Moves entries out of the pre-0.4.39 `globalState` cache and removes the old
     * keys, which otherwise stay in `state.vscdb` and are re-read at every startup
     * forever.
     *
     * @param keepEntries When false the old entries are discarded rather than
     *                    imported — used when they predate a hashing change and
     *                    would never be hit anyway.
     * @returns How many entries were imported.
     */
    async migrateFromMemento(store: LegacyStore, keepEntries: boolean): Promise<number> {
        const LEGACY_INDEX_KEY = 'tikzjax.cache.index';
        const LEGACY_PREFIX = 'tikzjax.cache.';

        const legacyIndex = store.get<string[]>(LEGACY_INDEX_KEY);
        if (!Array.isArray(legacyIndex) || legacyIndex.length === 0) {
            await store.update(LEGACY_INDEX_KEY, undefined);
            return 0;
        }

        let imported = 0;
        for (const hash of legacyIndex) {
            if (typeof hash !== 'string') { continue; }
            const key = `${LEGACY_PREFIX}${hash}`;
            const data = store.get<{ hash: string; svg: string; timestamp: number; accessCount: number }>(key);

            if (keepEntries && data && typeof data.svg === 'string') {
                try {
                    await this.set(hash, new CacheEntry(
                        data.hash ?? hash,
                        data.svg,
                        data.timestamp,
                        data.accessCount ?? 0
                    ));
                    imported++;
                } catch {
                    // A single unwritable entry must not abort the migration.
                }
            }

            await store.update(key, undefined);
        }

        await store.update(LEGACY_INDEX_KEY, undefined);
        await this.flushIndex();
        return imported;
    }

    /** Write any pending index changes. Call before the extension shuts down. */
    async dispose(): Promise<void> {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        await this.flushIndex();
    }

    // ── Internals ─────────────────────────────────────────────

    /**
     * Map a cache key to a filename.
     *
     * Keys are hashed rather than used directly: a cache key is arbitrary text, and
     * would otherwise be able to contain path separators, characters Windows
     * rejects, or more bytes than a filesystem allows in a name.
     */
    private static fileNameFor(hash: string): string {
        return createHash('sha256').update(hash).digest('hex') + CacheManager.SVG_EXT;
    }

    private async ensureIndex(): Promise<Map<string, IndexRecord>> {
        if (this.index) { return this.index; }
        if (!this.loading) {
            this.loading = this.loadIndex().then((index) => {
                this.index = index;
                this.loading = null;
                return index;
            });
        }
        return this.loading;
    }

    /**
     * Load the index and reconcile it against what is actually on disk.
     *
     * Records whose file is missing are dropped. Files no record points at are
     * deleted: filenames are one-way hashes of the cache key, so an orphan can
     * never be matched back to a key and is unreachable storage.
     */
    private async loadIndex(): Promise<Map<string, IndexRecord>> {
        await fsp.mkdir(this.cacheDir, { recursive: true });

        let records: unknown[] = [];
        try {
            const raw = await fsp.readFile(path.join(this.cacheDir, CacheManager.INDEX_FILE), 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.entries)) { records = parsed.entries; }
        } catch {
            // Missing or corrupt index — rebuild from whatever is on disk.
        }

        const unclaimed = new Set(await this.listSvgFiles());
        const index = new Map<string, IndexRecord>();

        for (const raw of records) {
            const record = raw as Partial<IndexRecord>;
            if (typeof record?.hash !== 'string' || typeof record?.file !== 'string') { continue; }
            if (!unclaimed.delete(record.file)) { continue; }

            index.set(record.hash, {
                hash: record.hash,
                file: record.file,
                timestamp: typeof record.timestamp === 'number' ? record.timestamp : Date.now(),
                accessCount: typeof record.accessCount === 'number' ? record.accessCount : 0,
                lastAccess: typeof record.lastAccess === 'number' ? record.lastAccess : 0,
                size: typeof record.size === 'number' ? record.size : 0,
            });
        }

        for (const orphan of unclaimed) {
            await this.unlinkQuietly(orphan);
        }

        return index;
    }

    private async listSvgFiles(): Promise<string[]> {
        try {
            const names = await fsp.readdir(this.cacheDir);
            return names.filter(n => n.endsWith(CacheManager.SVG_EXT));
        } catch {
            return [];
        }
    }

    private async unlinkQuietly(file: string): Promise<void> {
        try {
            await fsp.unlink(path.join(this.cacheDir, file));
        } catch {
            // Already gone, or never existed.
        }
    }

    /** Drop least-recently-used entries until both capacity limits are satisfied. */
    private async evictIfNeeded(index: Map<string, IndexRecord>): Promise<void> {
        let totalSize = 0;
        for (const record of index.values()) { totalSize += record.size; }

        if (index.size <= CacheManager.MAX_ENTRIES && totalSize <= CacheManager.MAX_TOTAL_BYTES) {
            return;
        }

        const byAge = [...index.values()].sort((a, b) => a.lastAccess - b.lastAccess);

        for (const record of byAge) {
            if (index.size <= CacheManager.MAX_ENTRIES && totalSize <= CacheManager.MAX_TOTAL_BYTES) {
                break;
            }
            index.delete(record.hash);
            totalSize -= record.size;
            await this.unlinkQuietly(record.file);
        }
    }

    private scheduleIndexFlush(): void {
        if (this.flushTimer) { return; }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            void this.flushIndex();
        }, CacheManager.INDEX_FLUSH_DELAY_MS);
    }

    /** Persist the index. Serialized so writes cannot land out of order. */
    private async flushIndex(): Promise<void> {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }

        const index = this.index;
        if (!index) { return; }

        const snapshot = JSON.stringify({ version: 1, entries: [...index.values()] });
        const target = path.join(this.cacheDir, CacheManager.INDEX_FILE);
        const temp = `${target}.${process.pid}.${this.tempCounter++}.tmp`;

        this.writeChain = this.writeChain.then(async () => {
            try {
                await fsp.mkdir(this.cacheDir, { recursive: true });
                await fsp.writeFile(temp, snapshot, 'utf8');
                await fsp.rename(temp, target);
            } catch {
                // A failed index write costs cache hits next session, nothing more.
            }
        });

        return this.writeChain;
    }
}
