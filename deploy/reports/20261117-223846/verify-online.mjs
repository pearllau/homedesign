import { chromium, expect, request } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:4175').origin;
const output = resolve(process.argv[3] || '.tmp/price-density-release/online');
await mkdir(output, { recursive: true });
const expected = JSON.parse(await readFile('data/prices/national-2026-10.json', 'utf8'));
const report = { origin, startedAt: new Date().toISOString(), checks: [], limitations: ['The application generation response is a fixed test fixture. All page assets, GET prices and POST estimates are served by the selected origin. This verifies the published price UI without invoking a paid model.'] };
function check(name, value, detail) {
  report.checks.push({ name, passed: Boolean(value), detail });
  if (!value) throw new Error(`${name}: ${JSON.stringify(detail)}`);
}
const api = await request.newContext({ baseURL: origin, timeout: 30000 });
let browser, context;
const errors = [];
try {
const designHtmlResponse = await api.get('/design');
check('GET /design HTML is successful', designHtmlResponse.status() === 200, designHtmlResponse.status());
const designHtml = await designHtmlResponse.text();
const chunkUrls = [...new Set([...designHtml.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"?#]+\.js(?:\?[^"#]*)?)"/g)].map(match => new URL(match[1], origin).href))];
check('/design references static JavaScript chunks', chunkUrls.length > 0, chunkUrls);
const designChunks = [];
for (const url of chunkUrls) {
  const chunkResponse = await api.get(url);
  check(`Fetch design chunk ${new URL(url).pathname}`, chunkResponse.status() === 200, chunkResponse.status());
  designChunks.push({ url: new URL(url).pathname, text: await chunkResponse.text() });
}
await writeFile(resolve(output, 'design.html'), designHtml);
await writeFile(resolve(output, 'design-chunks.json'), JSON.stringify(designChunks, null, 2));
const designRaw = `${designHtml}\n${designChunks.map(chunk => chunk.text).join('\n')}`;
const count = (text, literal) => text.split(literal).length - 1;
report.designRaw = {
  chunks: designChunks.map(chunk => chunk.url),
  returnToChat: count(designRaw, '返回对话'),
  modifyRequest: count(designRaw, '修改需求'),
  englishSlashEn: count(designRaw, 'English / EN'),
};
check('/design static source has one return label', report.designRaw.returnToChat === 1, report.designRaw);
check('/design static source has no legacy modify/language labels', report.designRaw.modifyRequest === 0 && report.designRaw.englishSlashEn === 0, report.designRaw);
const viewerResponse = await api.get('/floorplan-3d.html?v=prices-density-2');
check('GET viewer HTML is successful', viewerResponse.status() === 200, viewerResponse.status());
const viewerRaw = await viewerResponse.text();
await writeFile(resolve(output, 'floorplan-3d.html'), viewerRaw);
report.viewerRaw = {
  viewAll: count(viewerRaw, '查看全部'),
  example: count(viewerRaw, '示例'),
  fallbackSentence: count(viewerRaw, '项目内置离线基准'),
};
check('Viewer literals have one View All, an Example label, and at most one fallback phrase', report.viewerRaw.viewAll === 1 && report.viewerRaw.example >= 1 && report.viewerRaw.fallbackSentence <= 1, report.viewerRaw);
browser = await chromium.launch({ headless: true, channel: 'msedge' });
context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', locale: 'zh-CN' });
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const response = await api.get('/api/prices?scope=national');
  check('GET prices is successful', response.status() === 200, response.status());
  const book = await response.json();
  report.meta = book.meta;
  report.materials = book.materials;
  await writeFile(resolve(output, 'api-prices.json'), JSON.stringify(book, null, 2));
  check('Official and example counts come from server metadata', book.meta.officialMaterialCount === 1 && book.meta.fallbackMaterialCount === 7 && book.materials.length === 8, { official: book.meta.officialMaterialCount, example: book.meta.fallbackMaterialCount, materials: book.materials.length });
  for (const field of ['period', 'sourceUrl', 'publishedAt', 'sourceFileSha256', 'priceBasis']) check(`Immutable meta.${field}`, book.meta[field] === expected.meta[field], { actual: book.meta[field], expected: expected.meta[field] });
  const marble = book.materials.find(item => item.id === 'marble');
  check('Marble price remains official CNY 402 per square metre', marble?.confidence === 'official' && !marble?.fallback && ['low', 'mid', 'high'].every(key => marble[key] === 402), marble);
  const badRows = book.materials.filter(item => item.id !== 'marble' && (item.confidence !== 'fallback' || !item.fallback));
  check('Other seven rows retain fallback provenance', badRows.length === 0, badRows);
  const previous = JSON.parse(await readFile('deploy/reports/20261117-204740/online-verification.json', 'utf8'));
  const compareResponse = await api.post(`/api/prices?scope=national&period=${book.meta.period}`, {
    data: { items: previous.allMaterials.body.items.map(item => ({ key: item.key, materialId: item.materialId, area: item.area, includeInTotal: item.includeInTotal })) },
  });
  check('Same eight-material budget request succeeds', compareResponse.status() === 200, compareResponse.status());
  const compareEstimate = await compareResponse.json();
  report.unchangedBudget = { previousRelease: '20261117-204740', before: previous.allMaterials.body.totals, after: compareEstimate.totals, items: compareEstimate.items };
  check('Presentation changes do not change the same-plan budget', ['low', 'mid', 'high'].every(key => compareEstimate.totals?.[key] === previous.allMaterials.body.totals[key]), report.unchangedBudget);
  report.privatePaths = [];
  for (const path of ['/data/prices/national-2026-10.json', '/data/price-sources/beijing-2026-10.pdf', '/prices/national-2026-10.json']) {
    const result = await api.get(path);
    report.privatePaths.push({ path, status: result.status() });
    check(`Private source is not public: ${path}`, result.status() === 404, result.status());
  }

  // The bundled viewer exercises five or more material rows without relying on
  // generation output. It also provides a stable first-screen density sample.
  const viewer = await context.newPage();
  await viewer.goto(`${origin}/floorplan-3d.html?v=prices-density-2`, { waitUntil: 'networkidle' });
  await expect(viewer.locator('#panel .estimate-mid')).toContainText('按中位', { timeout: 30000 });
  report.bundled = await viewer.evaluate(() => ({
    rows: [...document.querySelectorAll('#panel .material-row')].map(node => {
      const title = node.querySelector('.material-title'), metrics = node.querySelector('.material-metrics');
      const rect = node.getBoundingClientRect(), panel = document.querySelector('#planDetailsPanel').getBoundingClientRect();
      return { id: node.dataset.material, height: rect.height, titleHeight: title.getBoundingClientRect().height, metricsHeight: metrics.getBoundingClientRect().height, visible: rect.top >= panel.top && rect.bottom <= panel.bottom, text: node.innerText };
    }),
    scrollTop: document.querySelector('aside.right').scrollTop,
    summary: document.querySelector('#panel .estimate-mid').innerText,
    basis: document.querySelector('#panel .estimate-basis').innerText,
    estimate: priceEstimate,
  }));
  check('Bundled plan shows at least five complete material rows', report.bundled.rows.filter(row => row.visible).length >= 5, report.bundled.rows);
  check('Default material panel starts at top', report.bundled.scrollTop === 0, report.bundled.scrollTop);
  check('Every material row uses two compact text lines', report.bundled.rows.every(row => row.height <= 58 && row.titleHeight <= 21 && row.metricsHeight <= 20), report.bundled.rows);
  check('Material rows contain no repeated provenance sentences', report.bundled.rows.every(row => !/回退|离线基准|项目内置/.test(row.text)), report.bundled.rows);
  check('Estimate amount and basis use separate lines', report.bundled.summary.startsWith('按中位 ¥') && report.bundled.basis === '全国参考 · 2026-10 · 1 项官方 / 7 项示例', { summary: report.bundled.summary, basis: report.bundled.basis });
  await viewer.screenshot({ path: resolve(output, 'materials-first-screen.png'), fullPage: true });
  await viewer.locator('#toggleAllMaterials').click();
  await expect(viewer.locator('#panel .material-row')).toHaveCount(8);
  check('Show all expands to eight materials', true, await viewer.locator('#toggleAllMaterials').getAttribute('aria-expanded'));
  await viewer.locator('#toggleAllMaterials').click();
  await viewer.locator('#drawer-about > summary').click();
  const about = viewer.locator('#drawer-about');
  await expect(about.locator('.price-summary')).toHaveText('1 项官方 · 7 项示例');
  await expect(about.locator('#about-area')).not.toHaveAttribute('open');
  await expect(about.locator('#about-prices')).not.toHaveAttribute('open');
  report.about = await about.locator('.rail-content').evaluate(node => {
    const panel = node.getBoundingClientRect(), source = node.querySelector('.price-source-links').getBoundingClientRect();
    return { width: panel.width, height: panel.height, scrollTop: node.scrollTop, sourceVisible: source.top >= panel.top && source.bottom <= panel.bottom, text: node.innerText, link: node.querySelector('.price-source-links a').href };
  });
  report.longSourceCount = (await viewer.locator('body').innerText()).split('项目内置离线基准').length - 1;
  check('Long provenance string appears exactly once when About is open', report.longSourceCount === 1, report.longSourceCount);
  check('Obsolete fallback sentence is absent', !(await viewer.locator('body').innerText()).includes('回退·项目内置离线基准'), null);
  check('About opens at top, no taller than 640px, with source link visible', report.about.scrollTop === 0 && report.about.height <= 640 && report.about.sourceVisible, report.about);
  check('About publication link matches unchanged official source', report.about.link === expected.meta.sourceUrl, report.about.link);
  await viewer.screenshot({ path: resolve(output, 'about-first-screen.png'), fullPage: true });
  await about.locator('.rail-content').screenshot({ path: resolve(output, 'about-panel.png') });
  await about.locator('#about-prices > summary').click();
  await expect(about.locator('table tbody tr')).toHaveCount(8);
  await expect(about.locator('table tbody tr').first().locator('.source-badge')).toHaveText('官方');
  await expect(about.locator('.price-audit')).toContainText('1 项官方 · 7 项离线基准');
  await expect(about.locator('.price-audit')).toContainText(expected.meta.sourceFileSha256);
  await viewer.screenshot({ path: resolve(output, 'about-expanded-prices.png'), fullPage: true });
  await about.locator('.rail-content').evaluate(node => node.scrollTop = node.scrollHeight);
  await about.locator(':scope > summary').click();
  await about.locator(':scope > summary').click();
  check('Reopening About restores top scroll position', await about.locator('.rail-content').evaluate(node => node.scrollTop) === 0);

  // Verify the top-level /design shell with the real deployed application. Only
  // generation is fulfilled locally; prices and iframe assets remain untouched.
  const app = await context.newPage();
  const plan = {
    style: '现代简约', overview: '价格密度验收方案', totalArea: 39,
    rooms: [
      { name: '客餐厅', width: 5, length: 4, area: 20 },
      { name: '厨房', width: 3, length: 3, area: 9 },
      { name: '卫生间', width: 2, length: 2, area: 4 },
      { name: '生活阳台', width: 3, length: 2, area: 6 },
    ], budget: { total: 0, items: [] },
  };
  await app.route('**/api/chat', route => {
    const events = [{ type: 'start', messageId: 'price-density-published-ui-fixture' }, { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: JSON.stringify(plan) }, { type: 'text-end', id: 'text' }, { type: 'finish', finishReason: 'stop' }];
    return route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' }, body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await app.goto(origin, { waitUntil: 'networkidle' });
  await app.getByRole('textbox').fill('生成价格密度验收方案');
  await app.getByRole('button', { name: '发送', exact: true }).click();
  await expect(app).toHaveURL(`${origin}/design`);
  await expect(app.getByRole('button', { name: '返回对话', exact: true })).toBeVisible();
  for (const name of ['后退', '前进', '返回上一级', '修改需求']) await expect(app.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(app.getByRole('combobox', { name: '切换三维工作台语言' })).toHaveValue('zh');
  const language = app.getByRole('combobox', { name: '切换三维工作台语言' });
  check('Selected language displays Simplified Chinese', await language.locator('option:checked').innerText() === '简体中文');
  report.header = await app.locator('.studio-header').innerText();
  check('Header contains no legacy arrows or modify button', !/[←→↑]|修改需求/.test(report.header), report.header);
  check('Header keeps only return, language and export controls',
    await app.locator('.studio-header-actions > button').count() === 1
      && await app.locator('.studio-header-actions > button').first().innerText() === '返回对话'
      && await app.locator('.studio-header select').count() === 1
      && await app.locator('.studio-export summary').innerText() === '导出'
      && !/上传户型图|校准/.test(report.header), report.header);
  const frame = app.frameLocator('iframe[title="户型设计与 3D 预览"]');
  await expect(frame.locator('#panel .estimate-mid')).toContainText('按中位', { timeout: 30000 });
  await expect(frame.locator('#panel .material-row')).toHaveCount(4);
  const ids = await frame.locator('#panel .material-row').evaluateAll(nodes => nodes.map(node => node.dataset.material));
  check('Current plan defaults to its four used materials', ['walnut', 'tile800', 'tile600', 'antislip'].every(id => ids.includes(id)), ids);
  await app.screenshot({ path: resolve(output, 'design-workbench.png'), fullPage: true });
  await frame.locator('#drawer-about > summary').click();
  await app.screenshot({ path: resolve(output, 'design-about.png'), fullPage: true });
  await app.getByRole('button', { name: '返回对话', exact: true }).click();
  await expect(app).toHaveURL(`${origin}/`);
  check('Return to conversation updates URL', true);

  // A mobile viewport must not introduce a horizontal page scrollbar.
  await viewer.setViewportSize({ width: 390, height: 844 });
  await viewer.locator('#about-prices').evaluate(node => node.open = false);
  await viewer.locator('#about-area').evaluate(node => node.open = false);
  report.mobile = await viewer.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth, aboutWidth: document.querySelector('#drawer-about .rail-content').getBoundingClientRect().width }));
  check('Mobile viewport has no horizontal document overflow', report.mobile.scrollWidth <= report.mobile.innerWidth, report.mobile);
  await viewer.screenshot({ path: resolve(output, 'about-mobile.png'), fullPage: true });
  check('No uncaught browser errors', errors.length === 0, errors);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = { message: error.message, stack: error.stack };
  const pages = context?.pages() || [];
  await Promise.allSettled(pages.map((page, i) => page.screenshot({ path: resolve(output, `failure-${i}.png`), fullPage: true })));
  process.exitCode = 1;
} finally {
  report.errors = errors;
  report.completedAt = new Date().toISOString();
  await writeFile(resolve(output, 'online-verification.json'), JSON.stringify(report, null, 2));
  await context?.close();
  await browser?.close();
  await api.dispose();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, output, error: report.error?.message }, null, 2));
}
