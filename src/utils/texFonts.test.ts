import * as fs from 'fs';
import * as path from 'path';
import { collectFontFamilies, embedTexFonts, clearFontCache } from './texFonts';

const FONT_DIR = path.resolve(__dirname, '..', '..', 'media', 'tex-fonts', 'ttf');
const CSS_FILE = path.resolve(__dirname, '..', '..', 'media', 'tex-fonts', 'tex-fonts.css');

const svgWith = (body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${body}</svg>`;

beforeEach(() => clearFontCache());

describe('collectFontFamilies', () => {
    it('finds each distinct family once', () => {
        const svg = svgWith(
            '<text font-family="cmr10">a</text>' +
            '<text font-family="cmmi10">b</text>' +
            '<text font-family="cmr10">c</text>'
        );
        expect(collectFontFamilies(svg).sort()).toEqual(['cmmi10', 'cmr10']);
    });

    it('splits a family list', () => {
        const svg = svgWith('<text font-family="cmr10, serif">a</text>');
        expect(collectFontFamilies(svg).sort()).toEqual(['cmr10', 'serif']);
    });

    it('strips quoting', () => {
        const svg = svgWith(`<text font-family="'cmr10'">a</text>`);
        expect(collectFontFamilies(svg)).toEqual(['cmr10']);
    });

    it('returns nothing for font-free art', () => {
        expect(collectFontFamilies(svgWith('<rect width="1" height="1"/>'))).toEqual([]);
    });
});

describe('embedTexFonts', () => {
    it('embeds a referenced TeX font as a data URI', () => {
        const out = embedTexFonts(svgWith('<text font-family="cmr10">a</text>'), FONT_DIR);

        expect(out).toContain('@font-face');
        expect(out).toContain('font-family:"cmr10"');
        expect(out).toContain('data:font/ttf;base64,');
    });

    it('embeds a valid TrueType payload', () => {
        const out = embedTexFonts(svgWith('<text font-family="cmr10">a</text>'), FONT_DIR);

        const match = out.match(/base64,([A-Za-z0-9+/=]+)"/);
        expect(match).not.toBeNull();

        const buf = Buffer.from(match![1], 'base64');
        // TrueType files start with 0x00010000, or 'true' on older Apple files.
        const magic = buf.readUInt32BE(0);
        expect(magic === 0x00010000 || magic === 0x74727565).toBe(true);
        expect(buf.length).toBe(fs.statSync(path.join(FONT_DIR, 'cmr10.ttf')).size);
    });

    it('embeds every font a math-heavy diagram references', () => {
        const svg = svgWith(
            '<text font-family="cmmi10">a</text>' +
            '<text font-family="cmsy10">b</text>' +
            '<text font-family="cmex10">c</text>'
        );
        const out = embedTexFonts(svg, FONT_DIR);

        expect((out.match(/@font-face/g) || [])).toHaveLength(3);
        for (const family of ['cmmi10', 'cmsy10', 'cmex10']) {
            expect(out).toContain(`font-family:"${family}"`);
        }
    });

    it('inserts the style before the drawing content', () => {
        const out = embedTexFonts(svgWith('<text font-family="cmr10">a</text>'), FONT_DIR);
        expect(out.indexOf('@font-face')).toBeLessThan(out.indexOf('<text'));
    });

    it('wraps the payload in CDATA so XML parsing cannot mangle it', () => {
        const out = embedTexFonts(svgWith('<text font-family="cmr10">a</text>'), FONT_DIR);
        expect(out).toContain('<![CDATA[');
        expect(out).toContain(']]>');
    });

    it('leaves font-free SVGs untouched', () => {
        const svg = svgWith('<rect width="1" height="1"/>');
        expect(embedTexFonts(svg, FONT_DIR)).toBe(svg);
    });

    it('skips families that are not bundled TeX fonts', () => {
        const svg = svgWith('<text font-family="sans-serif">a</text>');
        expect(embedTexFonts(svg, FONT_DIR)).toBe(svg);
    });

    it('embeds only the known fonts from a mixed list', () => {
        const svg = svgWith('<text font-family="cmr10, sans-serif">a</text>');
        const out = embedTexFonts(svg, FONT_DIR);

        expect((out.match(/@font-face/g) || [])).toHaveLength(1);
        expect(out).toContain('font-family:"cmr10"');
    });

    it('refuses family names that could escape the font directory', () => {
        const svg = svgWith('<text font-family="../../../etc/passwd">a</text>');
        expect(embedTexFonts(svg, FONT_DIR)).toBe(svg);
    });

    it('returns the input unchanged when there is no <svg> tag', () => {
        const notSvg = '<text font-family="cmr10">a</text>';
        expect(embedTexFonts(notSvg, FONT_DIR)).toBe(notSvg);
    });

    it('survives a missing font directory', () => {
        const svg = svgWith('<text font-family="cmr10">a</text>');
        expect(embedTexFonts(svg, path.join(FONT_DIR, 'nope'))).toBe(svg);
    });
});

describe('bundled font assets', () => {
    it('ships the fonts the preview stylesheet declares', () => {
        // A stylesheet pointing at files that are not packaged would leave the
        // preview silently falling back — which is the bug being fixed.
        const css = fs.readFileSync(CSS_FILE, 'utf8');
        const referenced = [...css.matchAll(/url\('([^']+)'\)/g)].map(m => m[1]);

        expect(referenced.length).toBeGreaterThan(100);

        const missing = referenced.filter(
            rel => !fs.existsSync(path.resolve(path.dirname(CSS_FILE), rel))
        );
        expect(missing).toEqual([]);
    });

    it('ships the fonts that TikZ output actually references', () => {
        // Observed in real node-tikzjax output: text uses cmr*, math uses
        // cmmi*/cmsy*/cmex*. A gap here shows up as mojibake, not as an error.
        for (const family of ['cmr10', 'cmr7', 'cmmi10', 'cmmi7', 'cmsy10', 'cmex10', 'cmbx10', 'cmti10']) {
            expect(fs.existsSync(path.join(FONT_DIR, `${family}.ttf`))).toBe(true);
        }
    });

    it('declares a @font-face for every shipped font', () => {
        const css = fs.readFileSync(CSS_FILE, 'utf8');
        const fonts = fs.readdirSync(FONT_DIR).filter(f => f.endsWith('.ttf'));

        const undeclared = fonts.filter(f => !css.includes(`url('ttf/${f}')`));
        expect(undeclared).toEqual([]);
    });
});
