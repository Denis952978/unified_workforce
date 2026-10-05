// Bundles the Netlify functions from functions-src/ into netlify/functions/ during the build.
// Bundling here (rather than leaving it to Netlify) lets us add a require() shim, which the
// database, email and token libraries need when they run inside an ES-module function.
import { build } from 'esbuild';
import { mkdirSync } from 'fs';
mkdirSync('netlify/functions', { recursive: true });
for (const name of ['api', 'deliver-email']) {
  await build({
    entryPoints: [`functions-src/${name}.mts`], outfile: `netlify/functions/${name}.mjs`,
    bundle: true, platform: 'node', format: 'esm', target: 'node20', external: ['pg-native'], logLevel: 'warning', legalComments: 'none',
    banner: { js: "import { createRequire as __uwsCreateRequire } from 'module'; const require = __uwsCreateRequire(import.meta.url);" },
  });
  console.log(`function built: netlify/functions/${name}.mjs`);
}
