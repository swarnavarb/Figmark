/**
 * Loads the built API the way the Azure host does: with its environment set.
 *
 * Parts of the config only run on Azure (`runningInAzure()`), so a fault there
 * passes every local test. If the API's entry point throws while loading, the
 * Functions host registers no functions at all and every /api route answers
 * 404 - sign-in included - while the build and the deploy both go green. A
 * `const` read before its declaration in config.ts did exactly that.
 *
 * Run in a child process so the Azure variables never leak into the other
 * suites. Needs `npm run build:api` first.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../api/dist/api/src/index.js', import.meta.url));

const result = spawnSync(
  process.execPath,
  ['--input-type=module', '-e', `await import(${JSON.stringify(entry)});`],
  {
    env: {
      PATH: process.env.PATH,
      // What App Service and Functions hosts set; see runningInAzure().
      WEBSITE_SITE_NAME: 'figmark-load-check',
      WEBSITE_INSTANCE_ID: 'load-check',
      WEBSITE_HOSTNAME: 'figmark-load-check.azurewebsites.net',
    },
    encoding: 'utf8',
  },
);

if (result.status !== 0) {
  const errors = (result.stderr ?? '').split('\n').filter((line) => line && !line.startsWith('WARNING:'));
  console.error('The API fails to load on Azure, so every /api route would answer 404:');
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('  ok  API loads with the Azure host environment');
