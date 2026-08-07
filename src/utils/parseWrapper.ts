/**
 * Installs a `parse` wrapper on a markdown-it instance that survives — and stays
 * outermost against — other extensions wrapping the same instance.
 *
 * Why an accessor rather than a plain assignment:
 *
 * VS Code invokes every `markdown.markdownItPlugins` contributor against the same
 * markdown-it instance, in an order that is not guaranteed. marp-vscode replaces
 * `md.parse` outright:
 *
 *     const Y = P.parse
 *     P.parse = (src, env) => {
 *       if (isMarpDeck(src)) { ...; return marpInstance.markdown.parse(src, env) }
 *       return Y.call(P, src, env)          // ← non-deck documents fall back
 *     }
 *
 * A plain `md.parse = wrapper` therefore loses to whoever assigns last, and
 * re-wrapping on a timer only papers over it — the timer can fire before or after
 * Marp depending on activation order, which is exactly the kind of run-to-run
 * difference that makes a preview "sometimes work".
 *
 * Defining `parse` as an accessor makes reads always return our wrapper while any
 * later assignment is captured as the new inner parse, so we are outermost
 * regardless of order, and applied exactly once per parse.
 *
 * The re-entrancy guard matters: because Marp captured *our wrapper* as its
 * fallback `Y`, a non-deck document would otherwise loop
 * wrapper → marpParse → wrapper → … forever. A nested call goes straight to the
 * original markdown-it parse, which is precisely what Marp's fallback wanted.
 */
export interface ParseWrapperHooks {
    /** Rewrite the source before parsing (include resolution, notes extraction). */
    transform(src: string): string;
    /** Runs after the inner parse returns, while any per-parse state is still fresh. */
    afterParse(): void;
    /** Diagnostic sink. */
    log(msg: string): void;
}

type ParseFn = (src: string, env?: any) => any;

export function installParseWrapper(md: any, hooks: ParseWrapperHooks): void {
    /**
     * Every `parse` implementation assigned to this instance, oldest first.
     * `chain[0]` is the original markdown-it parse.
     *
     * Each later extension captures `md.parse` (our wrapper) as its fallback, so a
     * re-entrant call is that extension delegating downwards. Nesting depth tells us
     * which link is calling, and therefore which one it meant to reach.
     */
    const chain: ParseFn[] = [md.parse.bind(md)];
    let depth = 0;

    const wrapper: ParseFn = function (src: string, env?: any) {
        // Pick the link below whoever is calling us. At the top level that is the
        // outermost implementation; each re-entry steps one link further down.
        const index = Math.max(0, chain.length - 1 - depth);
        const target = chain[index];

        // Re-entrant: the transform has already been applied to this source.
        if (depth > 0) {
            depth++;
            try {
                return target.call(md, src, env);
            } finally {
                depth--;
            }
        }

        depth++;
        try {
            const tokens = target.call(md, hooks.transform(src), env);
            hooks.afterParse();
            return tokens;
        } finally {
            depth--;
        }
    };

    Object.defineProperty(md, 'parse', {
        configurable: true,
        enumerable: true,
        get() { return wrapper; },
        set(next: ParseFn) {
            hooks.log('[parse-wrapper] md.parse replaced by another extension — re-wrapping');
            chain.push(next);
        },
    });
}
