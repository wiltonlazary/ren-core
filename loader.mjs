// ren-core/loader: `node --import ren-core/loader` compiles .jsx modules with
// esbuild's automatic JSX runtime (`jsxImportSource: "ren-core"`). For tests and
// scripts of packages built on ren-core; needs the optional peer esbuild.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

registerHooks({
  load(url, context, next) {
    if (!url.endsWith('.jsx')) return next(url, context);
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const { code } = transformSync(source, { loader: 'jsx', jsx: 'automatic', jsxImportSource: 'ren-core', format: 'esm', sourcefile: fileURLToPath(url), sourcemap: 'inline' });
    return { format: 'module', source: code, shortCircuit: true };
  },
});
