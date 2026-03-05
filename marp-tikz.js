#!/usr/bin/env node
/**
 * Pre-renders TikZ code blocks in a Markdown file to inline SVG images,
 * producing a temporary .md file that marp-cli can export to PPTX/PDF/HTML.
 *
 * Usage:
 *   node marp-tikz.js <input.md> [-- ...marp-cli args]
 *
 * Examples:
 *   node marp-tikz.js slides.md -- --pptx
 *   node marp-tikz.js slides.md -- --pptx --allow-local-files --html
 *   node marp-tikz.js slides.md -- --pdf
 */

const fs = require('fs');
const path = require('path');

async function renderTikzToSvg(source) {
    const mod = await import('node-tikzjax');
    const tex2svg = mod.default.default;

    // Preprocess: remove NBSP, trim lines, remove blanks
    let processed = source.replace(/\u00A0/g, ' ');
    processed = processed.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');

    // Downgrade pgfplots compat (engine limitation)
    processed = processed.replace(
        /\\pgfplotsset\s*\{\s*compat\s*=\s*[\d.]+\s*\}/,
        '\\pgfplotsset{compat=1.16}'
    );

    // Detect packages
    const packages = {};
    const pkgRegex = /\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}/g;
    let m;
    while ((m = pkgRegex.exec(processed)) !== null) {
        packages[m[2].trim()] = m[1] || '';
    }

    // Detect tikz libraries
    const libs = [];
    const libRegex = /\\usetikzlibrary\{([^}]+)\}/g;
    while ((m = libRegex.exec(processed)) !== null) {
        libs.push(...m[1].split(',').map(s => s.trim()));
    }

    const svg = await tex2svg(processed, {
        showConsole: false,
        texPackages: packages,
        tikzLibraries: libs.join(','),
    });

    return svg;
}

function fixSvgDimensions(svg) {
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    if (!viewBoxMatch) return svg;
    const parts = viewBoxMatch[1].trim().split(/\s+/);
    if (parts.length !== 4) return svg;
    let result = svg.replace(/(<svg[^>]*?\s)width="[^"]*"/, `$1width="${parts[2]}pt"`);
    result = result.replace(/(<svg[^>]*?\s)height="[^"]*"/, `$1height="${parts[3]}pt"`);
    return result;
}

async function main() {
    const separatorIdx = process.argv.indexOf('--');
    const args = process.argv.slice(2, separatorIdx === -1 ? undefined : separatorIdx);
    const marpArgs = separatorIdx === -1 ? ['--pptx'] : process.argv.slice(separatorIdx + 1);

    if (args.length === 0) {
        console.error('Usage: node marp-tikz.js <input.md> [-- ...marp-cli args]');
        process.exit(1);
    }

    const inputFile = path.resolve(args[0]);
    if (!fs.existsSync(inputFile)) {
        console.error(`File not found: ${inputFile}`);
        process.exit(1);
    }

    const inputDir = path.dirname(inputFile);
    let md = fs.readFileSync(inputFile, 'utf-8');

    // Create a tikz-images directory next to the input file
    const imgDir = path.join(inputDir, '.tikz-images');
    if (!fs.existsSync(imgDir)) {
        fs.mkdirSync(imgDir);
    }

    // Find all ```tikz ... ``` blocks
    const tikzRegex = /^```tikz\s*$([\s\S]*?)^```\s*$/gm;
    const blocks = [];
    let match;
    while ((match = tikzRegex.exec(md)) !== null) {
        blocks.push({ full: match[0], source: match[1] });
    }

    if (blocks.length === 0) {
        console.log('No TikZ blocks found, passing through to marp-cli directly.');
    } else {
        console.log(`Rendering ${blocks.length} TikZ diagram(s)...`);

        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            try {
                process.stdout.write(`  [${i + 1}/${blocks.length}] Rendering... `);
                const svg = await renderTikzToSvg(block.source);
                const fixed = fixSvgDimensions(svg);

                // Write SVG file next to the input markdown
                const svgFile = path.join(imgDir, `tikz-${i + 1}.svg`);
                fs.writeFileSync(svgFile, fixed, 'utf-8');

                // Use relative path from the markdown file's directory
                // Blank lines around the HTML block are critical for Marp to
                // correctly separate it from surrounding markdown content
                const relPath = `.tikz-images/tikz-${i + 1}.svg`;
                const imgTag = `\n<div style="display:flex;justify-content:center;align-items:center;"><img src="${relPath}" /></div>\n`;
                md = md.replace(block.full, imgTag);
                console.log('done');
            } catch (err) {
                console.log('FAILED');
                console.error(`    Error: ${err.message}`);
                md = md.replace(block.full, `<p style="color:red;">TikZ render failed: ${err.message}</p>`);
            }
        }
    }

    // Write processed markdown next to original
    const processedFile = inputFile.replace(/\.md$/, '.marp-processed.md');
    fs.writeFileSync(processedFile, md, 'utf-8');
    console.log(`Processed markdown: ${processedFile}`);

    // Determine output format from marp args
    const outputExt = marpArgs.includes('--pdf') ? '.pdf' : marpArgs.includes('--html') && !marpArgs.includes('--pptx') ? '.html' : '.pptx';
    const outputFile = inputFile.replace(/\.md$/, outputExt);

    const { execSync } = require('child_process');
    const marpBin = 'npx @marp-team/marp-cli';

    // Auto-enable --pptx-editable for Marp >= 4.1.0 when exporting PPTX
    if (outputExt === '.pptx' && !marpArgs.includes('--pptx-editable')) {
        try {
            const verOut = execSync(`${marpBin} --version`, { encoding: 'utf-8', cwd: inputDir }).trim();
            const verMatch = verOut.match(/(\d+\.\d+\.\d+)/);
            if (verMatch) {
                const [major, minor] = verMatch[1].split('.').map(Number);
                if (major > 4 || (major === 4 && minor >= 1)) {
                    marpArgs.push('--pptx-editable');
                    console.log(`Marp v${verMatch[1]} detected, enabling --pptx-editable`);
                }
            }
        } catch (_) {
            // Version check failed, proceed without --pptx-editable
        }
    }

    const cmd = `${marpBin} ${marpArgs.join(' ')} --allow-local-files --html "${processedFile}" -o "${outputFile}"`;

    console.log(`\nRunning: ${cmd}\n`);
    execSync(cmd, { stdio: 'inherit', cwd: inputDir });

    // Post-process editable PPTX: remove full-slide blank overlay shapes
    // LibreOffice's ODP→PPTX conversion creates opaque white rectangles
    // covering the entire slide that block clicking/selecting real content.
    if (marpArgs.includes('--pptx-editable') && outputExt === '.pptx') {
        try {
            await fixPptxOverlays(outputFile);
            console.log('Post-processed PPTX: removed overlay shapes.');
        } catch (err) {
            console.warn(`PPTX post-processing failed: ${err.message}`);
        }
    }

    // Cleanup
    fs.unlinkSync(processedFile);
    fs.rmSync(imgDir, { recursive: true, force: true });
    console.log('Cleaned up temporary files.');
}

/**
 * Remove full-slide blank overlay shapes from editable PPTX and renumber IDs.
 * LibreOffice's ODP→PPTX conversion creates opaque white rectangles
 * covering the entire slide that block clicking/selecting real content.
 * After removal, shape IDs are renumbered to be contiguous (PowerPoint
 * shows a repair prompt when IDs have gaps).
 */
async function fixPptxOverlays(pptxPath) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(pptxPath);
    let modified = false;

    for (const entry of zip.getEntries()) {
        if (!entry.entryName.match(/^ppt\/slides\/slide\d+\.xml$/)) continue;

        let xml = entry.getData().toString('utf-8');
        const original = xml;

        // Remove full-slide blank overlay shapes
        xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (match) => {
            const extMatch = match.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/);
            if (!extMatch) return match;
            const cx = parseInt(extMatch[1], 10);
            const cy = parseInt(extMatch[2], 10);
            if (cx < 12000000 || cy < 6800000) return match;
            const textRegex = /<a:t>([^<]*)<\/a:t>/g;
            let tm;
            while ((tm = textRegex.exec(match)) !== null) {
                if (tm[1].trim()) return match;
            }
            return '';
        });

        // Renumber shape IDs to be contiguous (starting from 2; 1 = group)
        if (xml !== original) {
            let nextId = 2;
            xml = xml.replace(/<p:cNvPr\s+id="(\d+)"/g, (match, id) => {
                if (id === '1') return match; // group shape stays id=1
                return `<p:cNvPr id="${nextId++}"`;
            });
            zip.updateFile(entry.entryName, Buffer.from(xml, 'utf-8'));
            modified = true;
        }
    }

    if (modified) {
        zip.writeZip(pptxPath);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
