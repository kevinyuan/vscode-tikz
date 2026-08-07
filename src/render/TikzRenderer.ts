import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';

export interface TikzRenderOptions {
    texPackages?: Record<string, string>;
    tikzLibraries?: string;
}

/** Thrown when a render exceeds its time budget. Always retryable. */
export class RenderTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Render timed out after ${timeoutMs}ms`);
        this.name = 'RenderTimeoutError';
    }
}

/** Thrown when the engine process died or was killed mid-render. Always retryable. */
export class EngineCrashError extends Error {
    constructor(detail: string) {
        super(`TeX engine stopped unexpectedly (${detail})`);
        this.name = 'EngineCrashError';
    }
}

type Pending = {
    resolve: (svg: string) => void;
    reject: (err: Error) => void;
};

/** How long to wait for a freshly spawned worker to finish loading the TeX engine. */
const WORKER_READY_TIMEOUT_MS = 30_000;

/**
 * Renders TikZ to SVG via a dedicated worker process.
 *
 * Why out-of-process (see also `workerMain.ts`):
 *  - `node-tikzjax`'s `library` module holds global mutable engine state, so two
 *    overlapping renders corrupt each other (`TeX engine render failed`).
 *  - Each render allocates ~69 MB of `WebAssembly.Memory`; keeping that out of the
 *    extension host avoids stalling VS Code.
 *  - A timeout can only be enforced by killing the process. In-process, an abandoned
 *    `tex2svg()` keeps mutating engine state and poisons every render after it.
 *
 * Renders are strictly serialized: exactly one request is outstanding at a time, and
 * the queue advances only when the underlying work genuinely settles — never merely
 * because a timeout fired.
 *
 * If spawning is unavailable (restricted or web extension host), falls back to
 * in-process rendering behind the same mutex.
 */
export class TikzRenderer {
    private _child: ChildProcess | null = null;
    private _readyPromise: Promise<void> | null = null;
    private _nextId = 1;
    private _pending = new Map<number, Pending>();

    /** Serializes callers: the next render waits for the previous one to fully settle. */
    private _queue: Promise<void> = Promise.resolve();

    /** Set once spawning has proven impossible; all further renders run in-process. */
    private _workerUnavailable = false;

    constructor(private readonly _log: (msg: string) => void) { }

    /**
     * Render TikZ source to SVG. Serialized against all other calls.
     *
     * @param timeoutMs Time budget. On expiry the worker is killed and respawned for
     *                  the next call, so a slow diagram cannot corrupt later ones.
     */
    async render(source: string, opts: TikzRenderOptions, timeoutMs: number): Promise<string> {
        const gate = this._queue;

        let release!: () => void;
        let released = false;
        const releaseOnce = () => { if (!released) { released = true; release(); } };
        this._queue = new Promise<void>((r) => { release = r; });

        await gate.catch(() => undefined);

        // The in-process path releases the mutex from the underlying promise, not here.
        let releaseDeferred = false;

        try {
            if (!this._workerUnavailable) {
                try {
                    await this._ensureWorker();
                } catch (err) {
                    // A genuine crash is reported to the caller; only an unusable spawn
                    // facility falls through to in-process rendering.
                    if (!this._workerUnavailable) { throw err; }
                }
            }

            if (this._workerUnavailable) {
                releaseDeferred = true;
                return await this._renderInProcess(source, opts, timeoutMs, releaseOnce);
            }

            return await this._sendToWorker(source, opts, timeoutMs);
        } finally {
            if (!releaseDeferred) { releaseOnce(); }
        }
    }

    /** Kill the worker and drop cached engine state. The next render respawns it. */
    reset(): void {
        this._killWorker('reset');
    }

    dispose(): void {
        this._killWorker('dispose');
    }

    // ── Worker path ───────────────────────────────────────────────

    private async _sendToWorker(
        source: string,
        opts: TikzRenderOptions,
        timeoutMs: number
    ): Promise<string> {
        const child = this._child;
        if (!child || !child.stdin?.writable) {
            throw new EngineCrashError('worker not running');
        }

        const id = this._nextId++;
        const result = new Promise<string>((resolve, reject) => {
            this._pending.set(id, { resolve, reject });
        });

        child.stdin.write(JSON.stringify({ id, source, opts }) + '\n');

        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_r, reject) => {
            timer = setTimeout(() => reject(new RenderTimeoutError(timeoutMs)), timeoutMs);
        });

        try {
            return await Promise.race([result, timeout]);
        } catch (err) {
            if (err instanceof RenderTimeoutError) {
                // Killing the worker is the only reliable way to abort a running TeX
                // compile. The replacement process starts with a clean engine.
                this._log(`[renderer] render ${id} timed out after ${timeoutMs}ms — killing worker`);
                this._killWorker('timeout');
            }
            throw err;
        } finally {
            if (timer) { clearTimeout(timer); }
            this._pending.delete(id);
        }
    }

    private _ensureWorker(): Promise<void> {
        if (this._child && this._readyPromise) { return this._readyPromise; }

        this._readyPromise = new Promise<void>((resolve, reject) => {
            const workerPath = path.join(__dirname, 'workerMain.js');
            let child: ChildProcess;

            try {
                child = spawn(process.execPath, [workerPath], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: {
                        ...process.env,
                        // The extension host binary is Electron; this makes it act as Node.
                        ELECTRON_RUN_AS_NODE: '1',
                        NODE_NO_WARNINGS: '1',
                    },
                });
            } catch (err: any) {
                this._workerUnavailable = true;
                this._log(`[renderer] spawn failed (${err?.message}) — using in-process rendering`);
                reject(new EngineCrashError('spawn unavailable'));
                return;
            }

            this._child = child;

            const readyTimer = setTimeout(() => {
                this._log('[renderer] worker failed to become ready — killing it');
                this._killWorker('ready timeout');
                reject(new EngineCrashError('ready timeout'));
            }, WORKER_READY_TIMEOUT_MS);

            const settleReady = () => { clearTimeout(readyTimer); resolve(); };

            /**
             * A killed worker's `exit`/`error`/`data` events arrive asynchronously,
             * by which time a replacement may already own the renderer state. Events
             * from a superseded child must not touch it.
             */
            const isCurrent = () => this._child === child;

            // Per-child buffer: a stale worker's trailing output must not be spliced
            // into the replacement's protocol stream.
            const buffer = { text: '' };

            child.stdout?.setEncoding('utf8');
            child.stdout?.on('data', (chunk: string) => {
                if (!isCurrent()) { return; }
                this._onStdout(buffer, chunk, settleReady);
            });

            child.stderr?.setEncoding('utf8');
            child.stderr?.on('data', (chunk: string) => {
                const text = chunk.trim();
                if (text) { this._log(`[renderer:stderr] ${text.slice(0, 500)}`); }
            });

            child.on('error', (err: Error) => {
                clearTimeout(readyTimer);
                reject(new EngineCrashError('spawn unavailable'));
                if (!isCurrent()) { return; }
                // spawn() reports ENOENT/EACCES asynchronously via 'error'.
                this._workerUnavailable = true;
                this._log(`[renderer] worker error (${err.message}) — using in-process rendering`);
                this._failAllPending(new EngineCrashError(err.message));
                this._child = null;
                this._readyPromise = null;
            });

            child.on('exit', (code, signal) => {
                clearTimeout(readyTimer);
                const detail = signal ? `signal ${signal}` : `exit code ${code}`;
                this._log(`[renderer] worker exited (${detail})`);
                reject(new EngineCrashError(detail));
                if (!isCurrent()) { return; }
                this._failAllPending(new EngineCrashError(detail));
                this._child = null;
                this._readyPromise = null;
            });
        });

        // A rejected ready-promise must not surface as an unhandled rejection; callers
        // observe the failure through their own render promise.
        this._readyPromise.catch(() => undefined);

        return this._readyPromise;
    }

    private _onStdout(buffer: { text: string }, chunk: string, onReady: () => void): void {
        buffer.text += chunk;

        let newlineIdx: number;
        while ((newlineIdx = buffer.text.indexOf('\n')) >= 0) {
            const line = buffer.text.slice(0, newlineIdx);
            buffer.text = buffer.text.slice(newlineIdx + 1);
            if (!line.trim()) { continue; }

            let msg: any;
            try {
                msg = JSON.parse(line);
            } catch {
                this._log(`[renderer] ignoring malformed worker output: ${line.slice(0, 200)}`);
                continue;
            }

            if (msg.ready) {
                this._log('[renderer] worker ready');
                onReady();
                continue;
            }
            if (msg.fatal) {
                this._log(`[renderer] worker fatal: ${msg.fatal}`);
                continue;
            }

            const pending = this._pending.get(msg.id);
            if (!pending) { continue; } // already timed out and abandoned
            this._pending.delete(msg.id);

            if (msg.ok) {
                pending.resolve(msg.svg);
            } else {
                pending.reject(new Error(msg.error ?? 'Unknown render error'));
            }
        }
    }

    private _failAllPending(err: Error): void {
        for (const pending of this._pending.values()) {
            pending.reject(err);
        }
        this._pending.clear();
    }

    private _killWorker(reason: string): void {
        const child = this._child;
        this._child = null;
        this._readyPromise = null;
        this._failAllPending(new EngineCrashError(reason));

        if (!child) { return; }
        try {
            child.stdin?.end();
            child.kill('SIGKILL');
        } catch {
            /* already gone */
        }
    }

    // ── In-process fallback ───────────────────────────────────────

    /**
     * Fallback for hosts where spawning is unavailable.
     *
     * A timeout here cannot abort the running TeX compile, so the mutex is released
     * from the underlying promise rather than from the race — otherwise the next
     * render would re-enter the single-threaded engine and corrupt it.
     */
    private async _renderInProcess(
        source: string,
        opts: TikzRenderOptions,
        timeoutMs: number,
        releaseOnce: () => void
    ): Promise<string> {
        let tex2svg: (src: string, opts: any) => Promise<string>;
        try {
            tex2svg = (await import('node-tikzjax')).default;
        } catch (err) {
            releaseOnce();
            throw err;
        }

        const work = tex2svg(source, opts as any);
        work.then(releaseOnce, releaseOnce);

        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_r, reject) => {
            timer = setTimeout(() => reject(new RenderTimeoutError(timeoutMs)), timeoutMs);
        });

        try {
            return await Promise.race([work, timeout]);
        } catch (err) {
            if (err instanceof RenderTimeoutError) {
                this._log('[renderer] in-process render timed out; holding the queue until it settles');
            }
            throw err;
        } finally {
            if (timer) { clearTimeout(timer); }
        }
    }
}
