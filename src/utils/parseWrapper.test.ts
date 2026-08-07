import { installParseWrapper, ParseWrapperHooks } from './parseWrapper';

/** Minimal markdown-it stand-in. `parse` records what the real parser received. */
function makeMd() {
    const rootCalls: string[] = [];
    const md: any = {
        parse(src: string, _env?: any) {
            rootCalls.push(src);
            return [{ type: 'root', src }];
        },
        render(src: string, env?: any) {
            return this.parse(src, env);
        },
    };
    return { md, rootCalls };
}

/**
 * Faithful stand-in for marp-vscode's wrapper: it captures the current `parse`,
 * replaces it, handles decks itself, and calls the captured function back for
 * everything else.
 */
function installMarpLike(md: any, marpCalls: string[]) {
    const previous = md.parse;
    md.parse = (src: string, env?: any) => {
        marpCalls.push(src);
        if (/^---[\s\S]*?marp:\s*true/m.test(src)) {
            return [{ type: 'marp', src }];
        }
        return previous.call(md, src, env);
    };
}

function makeHooks() {
    const transformed: string[] = [];
    const afterParseCalls: string[] = [];
    const hooks: ParseWrapperHooks = {
        transform(src) {
            transformed.push(src);
            return src.replace('%!include', 'INCLUDED');
        },
        afterParse() { afterParseCalls.push('after'); },
        log() { /* quiet */ },
    };
    return { hooks, transformed, afterParseCalls };
}

const DECK = '---\nmarp: true\n---\n\n# Slide';
const PLAIN = '# Just markdown';

describe('installParseWrapper', () => {
    describe('when installed before Marp', () => {
        it('stays outermost and transforms a deck exactly once', () => {
            const { md } = makeMd();
            const { hooks, transformed, afterParseCalls } = makeHooks();
            installParseWrapper(md, hooks);

            const marpCalls: string[] = [];
            installMarpLike(md, marpCalls);

            const tokens = md.parse(DECK);

            expect(transformed).toEqual([DECK]);
            expect(marpCalls).toEqual([DECK]);
            expect(afterParseCalls).toHaveLength(1);
            expect(tokens[0].type).toBe('marp');
        });

        it('does not recurse on a non-deck document', () => {
            // Marp captured our wrapper as its fallback; without the re-entrancy
            // guard this recurses until the stack blows.
            const { md, rootCalls } = makeMd();
            const { hooks, transformed } = makeHooks();
            installParseWrapper(md, hooks);
            installMarpLike(md, []);

            const tokens = md.parse(PLAIN);

            expect(transformed).toEqual([PLAIN]);
            expect(rootCalls).toEqual([PLAIN]);
            expect(tokens[0].type).toBe('root');
        });
    });

    describe('when installed after Marp', () => {
        it('still transforms a deck exactly once', () => {
            const { md } = makeMd();
            const marpCalls: string[] = [];
            installMarpLike(md, marpCalls);

            const { hooks, transformed, afterParseCalls } = makeHooks();
            installParseWrapper(md, hooks);

            const tokens = md.parse(DECK);

            expect(transformed).toEqual([DECK]);
            expect(marpCalls).toEqual([DECK]);
            expect(afterParseCalls).toHaveLength(1);
            expect(tokens[0].type).toBe('marp');
        });

        it('handles a non-deck document without recursing', () => {
            const { md, rootCalls } = makeMd();
            installMarpLike(md, []);
            const { hooks, transformed } = makeHooks();
            installParseWrapper(md, hooks);

            md.parse(PLAIN);

            expect(transformed).toEqual([PLAIN]);
            expect(rootCalls).toEqual([PLAIN]);
        });
    });

    it('applies the transform once, not once per wrapper layer', () => {
        // The previous implementation wrapped twice (sync + on a timer), so the
        // include resolver and speaker-note parser ran twice on every parse.
        const { md } = makeMd();
        const { hooks, transformed } = makeHooks();
        installParseWrapper(md, hooks);
        installMarpLike(md, []);

        md.parse('%!include theme.yaml\n\n# Hi');

        expect(transformed).toHaveLength(1);
    });

    it('passes the transformed source through to the parser', () => {
        const { md, rootCalls } = makeMd();
        const { hooks } = makeHooks();
        installParseWrapper(md, hooks);

        md.parse('%!include theme.yaml');

        expect(rootCalls).toEqual(['INCLUDED theme.yaml']);
    });

    it('survives several extensions wrapping after it', () => {
        const { md } = makeMd();
        const { hooks, transformed } = makeHooks();
        installParseWrapper(md, hooks);

        const order: string[] = [];
        for (const name of ['ext-a', 'ext-b', 'ext-c']) {
            const previous = md.parse;
            md.parse = (src: string, env?: any) => {
                order.push(name);
                return previous.call(md, src, env);
            };
        }

        md.parse(PLAIN);

        // Our transform runs before any of them: we are still outermost.
        expect(transformed).toEqual([PLAIN]);
        expect(order).toEqual(['ext-c', 'ext-b', 'ext-a']);
    });

    it('propagates env to the inner parser', () => {
        const { md } = makeMd();
        const seen: any[] = [];
        md.parse = (src: string, env?: any) => { seen.push(env); return [src]; };

        const { hooks } = makeHooks();
        installParseWrapper(md, hooks);

        md.parse(PLAIN, { currentDocument: 'x.md' });

        expect(seen).toEqual([{ currentDocument: 'x.md' }]);
    });
});
