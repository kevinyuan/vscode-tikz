/**
 * Out-of-process TikZ render worker.
 *
 * Runs in a dedicated Node process spawned by {@link TikzRenderer}. This exists
 * because `node-tikzjax` is fundamentally unsafe to run inside the extension host:
 *
 *  1. Its `library` module is a singleton with global mutable state (memory,
 *     filesystem, wasmExports, fileLoader). Two overlapping `tex2svg()` calls
 *     corrupt each other and produce `TeX engine render failed`.
 *  2. Every `tex()` call allocates a fresh 68.75 MB `WebAssembly.Memory`
 *     (1100 pages) and copies the core dump into it. Doing that in the extension
 *     host churns hundreds of MB and stalls every other extension.
 *  3. A TeX run cannot be cancelled in-process. A hung or very slow compile can
 *     only be recovered by killing the process that owns it.
 *
 * Protocol: newline-delimited JSON on stdin/stdout.
 *   in : {"id":1,"source":"...","opts":{...}}
 *   out: {"id":1,"ok":true,"svg":"..."} | {"id":1,"ok":false,"error":"..."}
 *   out: {"ready":true} once the engine is loaded.
 *
 * Requests are processed strictly one at a time.
 */

import * as readline from 'readline';

/** Write one NDJSON frame to stdout. */
function send(payload: unknown): void {
    process.stdout.write(JSON.stringify(payload) + '\n');
}

/**
 * stdout is the protocol channel — nothing else may write to it.
 * node-tikzjax (and jsdom) can emit console output, so redirect it to stderr.
 */
function protectStdout(): void {
    const toStderr = (...args: unknown[]) => {
        try { process.stderr.write(args.map(String).join(' ') + '\n'); } catch { /* ignore */ }
    };
    console.log = toStderr;
    console.info = toStderr;
    console.debug = toStderr;
    console.warn = toStderr;
}

interface RenderRequest {
    id: number;
    source: string;
    opts?: Record<string, unknown>;
}

async function main(): Promise<void> {
    protectStdout();

    const tex2svg = (await import('node-tikzjax')).default;

    // Warm the engine (unzips core.dump.gz + tex.wasm.gz, extracts tex_files.tar.gz)
    // before announcing readiness, so the first real render isn't charged for it.
    try {
        await tex2svg('\\begin{document}\\begin{tikzpicture}\\end{tikzpicture}\\end{document}', {});
    } catch {
        // A failed warm-up is not fatal; the first real render will surface any error.
    }

    send({ ready: true });

    let queue: Promise<void> = Promise.resolve();

    const rl = readline.createInterface({ input: process.stdin });

    rl.on('line', (line: string) => {
        if (!line.trim()) { return; }

        let req: RenderRequest;
        try {
            req = JSON.parse(line) as RenderRequest;
        } catch {
            return;
        }

        // Serialize: the TeX engine is a process-wide singleton.
        queue = queue.then(async () => {
            try {
                const svg = await tex2svg(req.source, req.opts ?? {});
                send({ id: req.id, ok: true, svg });
            } catch (err: any) {
                send({ id: req.id, ok: false, error: err?.message ?? String(err) });
            }
        });
    });

    rl.on('close', () => process.exit(0));
}

main().catch((err: any) => {
    send({ fatal: err?.message ?? String(err) });
    process.exit(1);
});
