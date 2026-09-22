// Lets Node's test runner import .jsx (and the image imports components use) without a bundler.
// Dev tooling only: Vite compiles the same files for the real build.
import { readFile } from 'node:fs/promises';
import { transformWithOxc } from 'vite';

const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/;

export async function load(url, context, nextLoad) {
  if (IMAGE.test(url)) {
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
  }
  if (!url.endsWith('.jsx')) return nextLoad(url, context);
  const source = await readFile(new URL(url), 'utf8');
  const { code, map } = await transformWithOxc(source, url, { jsx: { runtime: 'automatic' }, sourcemap: true });
  // Inline the source map so assertion stacks point at the real .jsx lines.
  const inline = map ? `
//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}` : '';
  return { format: 'module', shortCircuit: true, source: code + inline };
}
