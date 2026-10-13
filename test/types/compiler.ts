// ren-core/esbuild: the plugin and the compile functions.
import { ren, compile, transform } from 'ren-core/esbuild';
import { template, plan, h } from 'ren-core/jsx-runtime';

const plugin: { name: string; setup: (build: any) => void } = ren({ runtime: 'ren-core/jsx-runtime', filter: /\.jsx$/ });
const code: Promise<string> = compile('<p />', { loader: 'tsx', filename: 'a.tsx' });
const body: string = transform('__ren_h("p", null)');
const p = plan(['p', null, [0], null]);
const view: any = template(p, ['text']);
const call: any = h('div', { class: 'x' }, 'child');
void plugin, code, body, view, call;
// @ts-expect-error the loader is jsx or tsx
compile('', { loader: 'ts' });
