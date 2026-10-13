// ren-core/compiled: `node --import ren-core/compiled` compiles .jsx modules with the
// ren-core/esbuild compiler (ren-core templates), so a JSX suite run under both this
// and ren-core/loader checks compiled templates against the automatic runtime.
// Needs the optional peer esbuild.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { transform } from './src/esbuild.js';

registerHooks({
  load(url, context, next) {
    if (!url.endsWith('.jsx')) return next(url, context);
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const { code } = transformSync(source, { loader: 'jsx', jsx: 'transform', jsxFactory: '__ren_h', jsxFragment: '__ren_F', target: 'esnext', sourcefile: fileURLToPath(url) });
    return { format: 'module', source: transform(code), shortCircuit: true };
  },
});
