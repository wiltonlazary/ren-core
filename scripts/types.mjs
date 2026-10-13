// Generates the published declarations: `tsc` emits .d.ts files from the
// JSDoc of src/ into types/, then the handwritten JSX namespace joins them and
// the JSX runtimes re-export it for `jsxImportSource: "ren-core"`.
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
rmSync(`${here}types`, { recursive: true, force: true });
const tsc = `${dirname(require.resolve('typescript/package.json'))}/bin/tsc`;
execFileSync(process.execPath, [tsc, '-p', `${here}tsconfig.types.json`], { stdio: 'inherit' });
copyFileSync(`${here}src/jsx.d.ts`, `${here}types/jsx.d.ts`);
for (const runtime of ['jsx-runtime', 'jsx-dev-runtime']) appendFileSync(`${here}types/${runtime}.d.ts`, "export type { JSX } from './jsx.js';\n");
