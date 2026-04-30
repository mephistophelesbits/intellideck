/**
 * afterPack.js — electron-builder post-pack hook
 *
 * Removes build-time-only native modules that Next.js standalone copies
 * into its bundled node_modules but are not needed at runtime:
 *
 *   @next/swc-*          — Next.js Rust compiler (build tool, ~112 MB)
 *   @img/sharp-*         — Image optimizer (not needed, ~16 MB)
 *   @swc/*               — SWC core (build tool)
 *
 * With asar:false, the standalone is an extraResource at
 * Resources/app/.next/standalone/node_modules/.
 */

const path = require('path');
const fs = require('fs');

exports.default = async (context) => {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;

  const standaloneModules = process.platform === 'darwin'
    ? path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources', 'app', '.next', 'standalone', 'node_modules')
    : path.join(appOutDir, 'resources', 'app', '.next', 'standalone', 'node_modules');

  if (!fs.existsSync(standaloneModules)) return;

  const targets = fs.readdirSync(standaloneModules).filter(name =>
    name === '@next' || name === '@img' || name === '@swc'
  );

  for (const target of targets) {
    const fullPath = path.join(standaloneModules, target);
    const before = dirSizeMB(fullPath);
    fs.rmSync(fullPath, { recursive: true, force: true });
    console.log(`  afterPack: removed ${target}/ (${before} MB saved)`);
  }
};

function dirSizeMB(dir) {
  try {
    let total = 0;
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else total += fs.statSync(p).size;
      }
    };
    walk(dir);
    return (total / 1024 / 1024).toFixed(0);
  } catch {
    return '?';
  }
}
