import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url), quiet: true });
const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const lighthouseEntry = requireWeb.resolve('lighthouse');
const { default: lighthouse } = await import(pathToFileURL(lighthouseEntry).href);
const requireLighthouse = createRequire(lighthouseEntry);
const { launch } = await import(pathToFileURL(requireLighthouse.resolve('chrome-launcher')).href);
const directory = new URL('../.qa/lighthouse/', import.meta.url);
await mkdir(directory, { recursive: true });
const base = process.env.WEB_URL ?? 'http://localhost:3000';
const defaultRoutes = [
  '/',
  '/novosti',
  '/o-klube-volonterov',
  '/proekty',
  '/interv-yu-s-volonterami',
  '/partners',
  '/fotoalbomy',
  '/video',
  '/otchety',
  '/smi-o-nas',
  '/kontakty',
  '/donation',
  '/stat-volonterom',
  '/uchrezhdeniya',
  '/kalendar',
];
const routes = process.argv.length > 2 ? process.argv.slice(2) : defaultRoutes;
const chrome = await launch({
  chromePath: process.env.CHROME_PATH,
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'],
});
const summary = [];
try {
  for (const route of routes) {
    const result = await lighthouse(base + route, {
      port: chrome.port,
      output: ['json', 'html'],
      onlyCategories: ['performance', 'accessibility', 'seo'],
      logLevel: 'error',
    });
    if (!result) throw new Error('Lighthouse не вернул отчет.');
    const name = route === '/' ? 'home' : route.slice(1);
    await writeFile(new URL(name + '.json', directory), result.report[0]);
    await writeFile(new URL(name + '.html', directory), result.report[1]);
    const scores = {
      route,
      performance: Math.round((result.lhr.categories.performance?.score ?? 0) * 100),
      accessibility: Math.round((result.lhr.categories.accessibility?.score ?? 0) * 100),
      seo: Math.round((result.lhr.categories.seo?.score ?? 0) * 100),
    };
    summary.push(scores);
    console.log(JSON.stringify(scores));
  }
} finally {
  await chrome.kill();
  await writeFile(new URL('summary.json', directory), JSON.stringify(summary, null, 2));
}
if (summary.some((row) => row.performance < 85 || row.accessibility < 90 || row.seo < 90))
  process.exitCode = 1;
