import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, cpSync } from 'fs';
import { join, dirname } from 'path';

const production = process.argv.includes('--production');

// node-tikzjax loads WASM/dump files at runtime via __dirname-relative paths,
// so we must copy them into the output directory.
function copyTikzjaxAssets() {
    // node-tikzjax resolves files via path.join(__dirname, '../tex')
    // With bundle at dist/extension.js, __dirname = dist/
    // So it looks for tex/ at the package root (dist/../tex)
    const texSrc = 'node_modules/node-tikzjax/tex';
    const texDst = 'tex';  // package root, one level up from dist/
    if (!existsSync(texDst)) { mkdirSync(texDst, { recursive: true }); }
    for (const f of ['core.dump.gz', 'tex.wasm.gz', 'tex_files.tar.gz']) {
        copyFileSync(join(texSrc, f), join(texDst, f));
    }

    // Font CSS: node-tikzjax resolves via path.join(__dirname, '../css')
    const cssSrc = 'node_modules/node-tikzjax/css';
    const cssDst = 'css';
    if (existsSync(cssSrc)) {
        cpSync(cssSrc, cssDst, { recursive: true });
    }
}

await esbuild.build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !production,
    minify: production,
    // node-tikzjax uses dynamic require for WASM — handle via asset copy
});

copyTikzjaxAssets();
console.log('Build complete');
