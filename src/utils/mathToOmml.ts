/**
 * Converts LaTeX math to OMML (Office Math Markup Language) for native
 * PowerPoint math objects. Pipeline: LaTeX → MathML (temml) → OMML (custom).
 *
 * Returns the inner content of <m:oMath>...</m:oMath> (without the wrapper).
 * The caller wraps it as needed.
 */

import { DOMParser } from '@xmldom/xmldom';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const temml = require('temml') as {
    renderToString(latex: string, options?: Record<string, unknown>): string;
};

// N-ary operators: limits rendered above/below (undOvr)
const NARY_UNDOVR = new Set(['∑', '∏', '⋂', '⋃', '⊕', '⊗', '⊙', '⊎']);
// N-ary operators: limits rendered as sub/superscript (subSup)
const NARY_SUBSUP = new Set(['∫', '∬', '∭', '∮', '∯', '∰', '∱', '∲', '∳']);
const ALL_NARY = new Set([...NARY_UNDOVR, ...NARY_SUBSUP]);

/**
 * Converts a LaTeX string to an OMML XML string (the <m:oMath> wrapper included).
 * On temml parse failure, returns an OMML run with an error placeholder.
 */
export function latexToOmml(latex: string, isDisplay: boolean): string {
    let mathmlStr: string;
    try {
        mathmlStr = temml.renderToString(latex, {
            output: 'mathml',
            displayMode: isDisplay,
            throwOnError: false,
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return `<m:oMath><m:r><m:t>[Math error: ${xmlEscape(msg)}]</m:t></m:r></m:oMath>`;
    }

    try {
        const doc = new DOMParser().parseFromString(mathmlStr, 'text/xml');
        const mathEl = doc.documentElement;
        const inner = convertChildren(mathEl);
        return `<m:oMath>${inner}</m:oMath>`;
    } catch (e: unknown) {
        return `<m:oMath><m:r><m:t>[Conversion error]</m:t></m:r></m:oMath>`;
    }
}

// ─── Node conversion ─────────────────────────────────────────────────────────

function convertNode(node: Node): string {
    if (node.nodeType === 3) { // TEXT_NODE
        const text = (node.nodeValue || '').trim();
        return text ? xmlEscape(text) : '';
    }
    if (node.nodeType !== 1) { return ''; }
    const el = node as Element;
    const tag = localName(el);

    switch (tag) {
        case 'math':      return convertMrow(el);
        case 'mrow':
        case 'mpadded':
        case 'mphantom':
        case 'mstyle':
        case 'menclose': return convertMrow(el);

        case 'mi': { const {text: t, style: s} = decodeMathAlpha(textContent(el), 'i'); return makeRun(t, s); }
        case 'mn': { const {text: t, style: s} = decodeMathAlpha(textContent(el), 'p'); return makeRun(t, s); }
        case 'mo':    return makeRun(textContent(el), 'p');
        case 'mtext': return makeRun(textContent(el), 'p');
        case 'mspace': {
            // Convert MathML spacing to em-space chars; \qquad=2em, \quad=1em, etc.
            const w = el.getAttribute('width') || '';
            const em = parseFloat(w);
            if (!isNaN(em) && em >= 1.5) { return makeRun('\u2003\u2003', 'p'); }
            if (!isNaN(em) && em >= 0.5) { return makeRun('\u2003', 'p'); }
            return '';
        }

        case 'msup':      return makeMsup(el);
        case 'msub':      return makeMsub(el);
        case 'msubsup':   return makeMsubsup(el);
        case 'mover':     return makeMover(el);
        case 'munder':    return makeMunder(el);
        case 'munderover':return makeMunderover(el);
        case 'mfrac':     return makeMfrac(el);
        case 'msqrt':     return makeMsqrt(el);
        case 'mroot':     return makeMroot(el);
        case 'mtable':    return makeMtable(el);
        case 'mtr':       return `<m:mr>${convertChildren(el)}</m:mr>`;
        case 'mtd':       return `<m:e>${convertChildren(el)}</m:e>`;
        case 'merror':    return makeRun('[?]', 'p');

        case 'semantics': {
            const first = childElements(el)[0];
            return first ? convertNode(first) : '';
        }
        case 'annotation':
        case 'annotation-xml': return '';

        default: return convertChildren(el);
    }
}

function convertChildren(el: Element | Node): string {
    let out = '';
    for (let i = 0; i < el.childNodes.length; i++) {
        out += convertNode(el.childNodes.item(i) as Node);
    }
    return out;
}

/**
 * Converts an mrow-like element, coalescing nary operators with their body.
 * When we see msubsup/munderover whose base is a nary character, the immediately
 * following sibling element becomes the body of <m:nary>.
 */
function convertMrow(el: Element): string {
    const kids = childElements(el);
    let out = '';
    let i = 0;
    while (i < kids.length) {
        const child = kids[i];
        const tag = localName(child);
        // In display mode, temml may wrap the nary in a singleton <mrow>;
        // detect that and treat it as if the nary were a direct child.
        const naryEl: Element | null =
            (tag === 'msubsup' || tag === 'munderover') && isNaryElement(child) ? child
            : tag === 'mrow' && isNarySingletonMrow(child) ? childElements(child)[0]!
            : null;
        if (naryEl) {
            const naryTag = localName(naryEl);
            const naryKids = childElements(naryEl);
            const chr  = textContent(naryKids[0]!);
            const sub  = (naryTag === 'munderover' || naryTag === 'msubsup') ? (naryKids[1] ?? null) : null;
            const sup  = (naryTag === 'munderover' || naryTag === 'msubsup') ? (naryKids[2] ?? null) : null;
            // Next sibling element becomes the body of the n-ary operator
            const bodyEl = kids[i + 1];
            const bodyStr = bodyEl ? convertNode(bodyEl) : '';
            out += makeNary(chr, sub, sup, bodyStr);
            if (bodyEl) { i++; }
        } else {
            out += convertNode(child);
        }
        i++;
    }
    return out;
}

// ─── Element constructors ─────────────────────────────────────────────────────

function makeMsup(el: Element): string {
    const [base, sup] = childElements(el);
    return `<m:sSup><m:sSupPr><m:ctrlPr/></m:sSupPr>` +
           `<m:e>${base ? convertNode(base) : ''}</m:e>` +
           `<m:sup>${sup ? convertNode(sup) : ''}</m:sup></m:sSup>`;
}

function makeMsub(el: Element): string {
    const [base, sub] = childElements(el);
    return `<m:sSub><m:sSubPr><m:ctrlPr/></m:sSubPr>` +
           `<m:e>${base ? convertNode(base) : ''}</m:e>` +
           `<m:sub>${sub ? convertNode(sub) : ''}</m:sub></m:sSub>`;
}

function makeMsubsup(el: Element): string {
    const [base, sub, sup] = childElements(el);
    if (base && isNaryBase(base)) {
        return makeNary(textContent(base), sub ?? null, sup ?? null, '');
    }
    return `<m:sSubSup><m:sSubSupPr><m:ctrlPr/></m:sSubSupPr>` +
           `<m:e>${base ? convertNode(base) : ''}</m:e>` +
           `<m:sub>${sub ? convertNode(sub) : ''}</m:sub>` +
           `<m:sup>${sup ? convertNode(sup) : ''}</m:sup></m:sSubSup>`;
}

/**
 * Maps MathML <mover> accent characters to their OMML combining equivalents.
 * MathML uses standalone characters (e.g. '^' U+005E); OMML <m:acc> needs
 * combining diacritics (e.g. U+0302) to position correctly above the base.
 * A null value means: omit <m:chr> and use the OMML default (U+0302 circumflex).
 */
const ACCENT_TO_OMML: Record<string, string | null> = {
    '^':      null,       // U+005E → omit (OMML default = U+0302 combining circumflex)
    '\u02C6': null,       // ˆ MODIFIER LETTER CIRCUMFLEX → same as above
    '~':      '\u0303',   // tilde → combining tilde
    '\u02DC': '\u0303',   // ˜ SMALL TILDE → combining tilde
    '\u00B4': '\u0301',   // ´ ACUTE ACCENT → combining acute
    '\u0060': '\u0300',   // ` GRAVE ACCENT → combining grave
    '\u00A8': '\u0308',   // ¨ DIAERESIS → combining diaeresis (ddot)
    '\u02D9': '\u0307',   // ˙ DOT ABOVE → combining dot above (dot)
    '\u203E': '\u0305',   // ‾ OVERLINE → combining overline (bar)
    '\u2192': '\u20D7',   // → RIGHT ARROW → combining right arrow above (vec)
    '\u2190': '\u20D6',   // ← LEFT ARROW → combining left arrow above
};

function makeMover(el: Element): string {
    const [base, over] = childElements(el);
    if (over && localName(over) === 'mo') {
        const chr = textContent(over);
        if (base && isNaryBase(base)) {
            return makeNary(textContent(base), null, over, '');
        }
        // Map to OMML combining character; null = use OMML default (no <m:chr>)
        const ommlChr = Object.prototype.hasOwnProperty.call(ACCENT_TO_OMML, chr)
            ? ACCENT_TO_OMML[chr]
            : chr;
        const chrAttr = ommlChr !== null
            ? `<m:chr m:val="${xmlEscape(ommlChr)}"/>`
            : '';  // omit → OMML default circumflex (U+0302)
        return `<m:acc><m:accPr>${chrAttr}<m:ctrlPr/></m:accPr>` +
               `<m:e>${base ? convertNode(base) : ''}</m:e></m:acc>`;
    }
    return `<m:limUpp><m:limUppPr><m:ctrlPr/></m:limUppPr>` +
           `<m:e>${base ? convertNode(base) : ''}</m:e>` +
           `<m:lim>${over ? convertNode(over) : ''}</m:lim></m:limUpp>`;
}

function makeMunder(el: Element): string {
    const [base, under] = childElements(el);
    if (under && localName(under) === 'mo') {
        const chr = textContent(under);
        if (chr === '⏟' || chr === '⌣') {
            return `<m:limLow><m:limLowPr><m:ctrlPr/></m:limLowPr>` +
                   `<m:e>${base ? convertNode(base) : ''}</m:e>` +
                   `<m:lim>${convertNode(under)}</m:lim></m:limLow>`;
        }
    }
    return `<m:limLow><m:limLowPr><m:ctrlPr/></m:limLowPr>` +
           `<m:e>${base ? convertNode(base) : ''}</m:e>` +
           `<m:lim>${under ? convertNode(under) : ''}</m:lim></m:limLow>`;
}

function makeMunderover(el: Element): string {
    const [base, under, over] = childElements(el);
    if (base && isNaryBase(base)) {
        return makeNary(textContent(base), under ?? null, over ?? null, '');
    }
    // Nest: limUpp(limLow(base, under), over)
    const inner = `<m:limLow><m:limLowPr><m:ctrlPr/></m:limLowPr>` +
                  `<m:e>${base ? convertNode(base) : ''}</m:e>` +
                  `<m:lim>${under ? convertNode(under) : ''}</m:lim></m:limLow>`;
    return `<m:limUpp><m:limUppPr><m:ctrlPr/></m:limUppPr>` +
           `<m:e>${inner}</m:e>` +
           `<m:lim>${over ? convertNode(over) : ''}</m:lim></m:limUpp>`;
}

function makeNary(chr: string, sub: Element | null, sup: Element | null, body: string): string {
    const limLoc = NARY_UNDOVR.has(chr) ? 'undOvr' : 'subSup';
    return `<m:nary><m:naryPr>` +
           `<m:chr m:val="${xmlEscape(chr)}"/>` +
           `<m:limLoc m:val="${limLoc}"/>` +
           `<m:subHide m:val="${sub ? '0' : '1'}"/>` +
           `<m:supHide m:val="${sup ? '0' : '1'}"/>` +
           `<m:ctrlPr/></m:naryPr>` +
           `<m:sub>${sub ? convertNode(sub) : ''}</m:sub>` +
           `<m:sup>${sup ? convertNode(sup) : ''}</m:sup>` +
           `<m:e>${body}</m:e></m:nary>`;
}

function makeMfrac(el: Element): string {
    const [num, den] = childElements(el);
    return `<m:f><m:fPr><m:ctrlPr/></m:fPr>` +
           `<m:num>${num ? convertNode(num) : ''}</m:num>` +
           `<m:den>${den ? convertNode(den) : ''}</m:den></m:f>`;
}

function makeMsqrt(el: Element): string {
    return `<m:rad><m:radPr><m:degHide m:val="1"/><m:ctrlPr/></m:radPr>` +
           `<m:deg/><m:e>${convertChildren(el)}</m:e></m:rad>`;
}

function makeMroot(el: Element): string {
    // mroot children: [radicand, index]
    const [radicand, index] = childElements(el);
    return `<m:rad><m:radPr><m:ctrlPr/></m:radPr>` +
           `<m:deg>${index ? convertNode(index) : ''}</m:deg>` +
           `<m:e>${radicand ? convertNode(radicand) : ''}</m:e></m:rad>`;
}

function makeMtable(el: Element): string {
    const mtrRows = childElements(el).filter(c => localName(c) === 'mtr');

    // Detect temml's \tag structure: single mtr.tml-tageqn with 3 mtd cells
    // [empty-spacer | formula | tag-number]. The empty cell renders as a dashed
    // placeholder box in PowerPoint, so we unwrap and emit only formula + tag.
    if (mtrRows.length === 1) {
        const cls = mtrRows[0].getAttribute('class') || '';
        if (cls.includes('tml-tageqn')) {
            const cells = childElements(mtrRows[0]).filter(c => localName(c) === 'mtd');
            if (cells.length === 3) {
                const formula = convertChildren(cells[1]);
                const tag    = convertChildren(cells[2]);
                return formula + tag;
            }
        }
    }

    const rows = mtrRows.map(r => convertNode(r)).join('');
    return `<m:m><m:mPr><m:ctrlPr/></m:mPr>${rows}</m:m>`;
}

/**
 * Converts Unicode Mathematical Alphanumeric Symbols (U+1D400 block) back to
 * ASCII with the appropriate OMML style. Temml encodes \mathbf, \mathit etc.
 * as Plane-1 chars; PowerPoint fonts don't support them → dashed box.
 */
function decodeMathAlpha(raw: string, defaultStyle: 'i' | 'p' | 'b' | 'bi'): {text: string, style: 'i' | 'p' | 'b' | 'bi'} {
    let style: 'i' | 'p' | 'b' | 'bi' = defaultStyle;
    let text = '';
    let changed = false;
    for (const ch of raw) {
        const cp = ch.codePointAt(0)!;
        // Mathematical Bold Capital A-Z: U+1D400-U+1D419
        if (cp >= 0x1D400 && cp <= 0x1D419) { text += String.fromCharCode(0x41 + cp - 0x1D400); style = 'b'; changed = true; }
        // Mathematical Bold Small a-z: U+1D41A-U+1D433
        else if (cp >= 0x1D41A && cp <= 0x1D433) { text += String.fromCharCode(0x61 + cp - 0x1D41A); style = 'b'; changed = true; }
        // Mathematical Italic Capital A-Z: U+1D434-U+1D44D
        else if (cp >= 0x1D434 && cp <= 0x1D44D) { text += String.fromCharCode(0x41 + cp - 0x1D434); style = 'i'; changed = true; }
        // Mathematical Italic Small a-z: U+1D44E-U+1D467
        else if (cp >= 0x1D44E && cp <= 0x1D467) { text += String.fromCharCode(0x61 + cp - 0x1D44E); style = 'i'; changed = true; }
        // Mathematical Bold Italic Capital A-Z: U+1D468-U+1D481
        else if (cp >= 0x1D468 && cp <= 0x1D481) { text += String.fromCharCode(0x41 + cp - 0x1D468); style = 'bi'; changed = true; }
        // Mathematical Bold Italic Small a-z: U+1D482-U+1D49B
        else if (cp >= 0x1D482 && cp <= 0x1D49B) { text += String.fromCharCode(0x61 + cp - 0x1D482); style = 'bi'; changed = true; }
        // Mathematical Bold Digits 0-9: U+1D7CE-U+1D7D7
        else if (cp >= 0x1D7CE && cp <= 0x1D7D7) { text += String.fromCharCode(0x30 + cp - 0x1D7CE); style = 'b'; changed = true; }
        else { text += ch; }
    }
    return changed ? {text, style} : {text: raw, style: defaultStyle};
}

function makeRun(text: string, style: 'i' | 'p' | 'b' | 'bi'): string {
    return `<m:r><m:rPr><m:sty m:val="${style}"/></m:rPr><m:t>${xmlEscape(text)}</m:t></m:r>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function localName(el: Element): string {
    return (el.localName || el.nodeName || '').replace(/^.*:/, '');
}

function childElements(el: Element | Node): Element[] {
    const out: Element[] = [];
    for (let i = 0; i < el.childNodes.length; i++) {
        const node = el.childNodes.item(i) as Node;
        if (node.nodeType === 1) { out.push(node as Element); }
    }
    return out;
}

function textContent(node: Node): string {
    let out = '';
    for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes.item(i) as Node;
        if (child.nodeType === 3) { out += child.nodeValue || ''; }
        else if (child.nodeType === 1) { out += textContent(child); }
    }
    return out;
}

/** Returns true when el is an mrow containing exactly one nary msubsup/munderover. */
function isNarySingletonMrow(el: Element): boolean {
    const kids = childElements(el);
    return kids.length === 1 &&
        (localName(kids[0]) === 'msubsup' || localName(kids[0]) === 'munderover') &&
        isNaryElement(kids[0]);
}

function isNaryBase(el: Element): boolean {
    return localName(el) === 'mo' && ALL_NARY.has(textContent(el));
}

function isNaryElement(el: Element): boolean {
    const base = childElements(el)[0];
    return !!base && isNaryBase(base);
}

function xmlEscape(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
