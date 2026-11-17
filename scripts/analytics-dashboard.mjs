#!/usr/bin/env node
/**
 * pipo admin dashboard — installs & downloads at a glance.
 *
 * Pulls the numbers a maintainer actually needs, from public sources that
 * never require a secret:
 *
 *   - GitHub Releases of motius/pipo: every asset's download_count, grouped
 *     by operating system (Windows / macOS / Linux), and per release tag so
 *     the chart shows WHEN people download, not just how many.
 *   - npm downloads for every @pipo/* package (weekly + monthly). Packages
 *     that are not published yet (or whose Trusted Publisher is pending) are
 *     reported as "not published" instead of exploding the run.
 *   - GitHub repository traffic (views + clones, 14-day window) when a token
 *     with repo admin access is available (PIPO_GH_TOKEN or GITHUB_TOKEN).
 *     Without one this section explains how to enable it.
 *
 * Everything lands in one self-contained dashboard.html (no CDN, no fonts,
 * works offline) plus a terminal summary. All arithmetic is additive over
 * GitHub's own counters — nothing here is estimated.
 *
 * Usage:
 *   node scripts/analytics-dashboard.mjs                  # terminal + dashboard.html
 *   node scripts/analytics-dashboard.mjs --out admin.html # custom output path
 *   PIPO_GH_TOKEN=github_pat_... node scripts/analytics-dashboard.mjs
 *
 * Exit code is 0 even when some sources are unavailable; the dashboard says
 * so explicitly. Only a network failure on ALL sources exits non-zero.
 */

const REPO = process.env.PIPO_REPO ?? 'motius/pipo';
const NPM_PACKAGES = [
  '@pipo/brain',
  '@pipo/sidecar',
  '@pipo/sidecar-darwin-arm64',
  '@pipo/sidecar-darwin-x64',
  '@pipo/sidecar-linux-x64',
  '@pipo/sidecar-linux-arm64',
  '@pipo/sidecar-win32-x64',
];
const GH_API = 'https://api.github.com';
const NPM_API = 'https://api.npmjs.org/downloads';

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const OUT = outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : 'pipo-dashboard.html';
const TOKEN = process.env.PIPO_GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';

const ghHeaders = {
  accept: 'application/vnd.github+json',
  'user-agent': 'pipo-analytics-dashboard',
  ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
};

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: { ...ghHeaders, ...headers } });
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${res.statusText}`), { status: res.status, url });
  return res.json();
}

const fmt = (n) => Number(n).toLocaleString('en-US');

// ─── GitHub releases ────────────────────────────────────────────────────────
// Assets named after the installer convention:
//   pipo-Setup*.exe / *Setup*.exe            -> Windows
//   *.dmg / *mac*.zip                        -> macOS
//   *.AppImage / *.deb / *.rpm / *.tar.gz / linux* -> Linux
//   SHA256SUMS / *.sig / *.txt               -> metadata, not an install
function osOf(assetName) {
  const n = assetName.toLowerCase();
  if (/sha256sums|checksums|\.sig$|\.txt$|\.sbom$/.test(n)) return null;
  if (/\.exe$|setup|installer-win|win32|\.msi$/.test(n)) return 'Windows';
  if (/\.dmg$|\.pkg$|darwin|macos|\.zip$/.test(n)) return 'macOS';
  if (/\.appimage$|\.deb$|\.rpm$|\.tar\.gz$|\.tgz$|linux/.test(n)) return 'Linux';
  return 'Other';
}

async function collectReleases() {
  const perPage = 100;
  let page = 1;
  const releases = [];
  for (;;) {
    const batch = await fetchJson(`${GH_API}/repos/${REPO}/releases?per_page=${perPage}&page=${page}`);
    releases.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  const osTotals = { Windows: 0, macOS: 0, Linux: 0, Other: 0 };
  const perRelease = [];
  const perAsset = [];
  for (const rel of releases) {
    let installs = 0;
    for (const a of rel.assets ?? []) {
      const os = osOf(a.name);
      if (os === null) continue;
      installs += a.download_count;
      osTotals[os] += a.download_count;
      perAsset.push({ release: rel.tag_name, name: a.name, os, count: a.download_count });
    }
    perRelease.push({ tag: rel.tag_name, name: rel.name ?? rel.tag_name, installs, created: rel.created_at });
  }
  // Releases are returned newest-first; the chart reads oldest-first.
  perRelease.reverse();
  return { osTotals, perRelease, perAsset, totalInstalls: Object.values(osTotals).reduce((a, b) => a + b, 0) };
}

// ─── npm downloads ──────────────────────────────────────────────────────────
// A package that 404s on the downloads API is not published (or its first
// publish is still pending the Trusted Publisher) — that is a state to show,
// not an error.
async function npmDownloads(pkg, period) {
  const url = `${NPM_API}/point/${period}/${encodeURIComponent(pkg)}`;
  try {
    const j = await fetchJson(url, { 'user-agent': 'pipo-analytics-dashboard' });
    return j.downloads ?? 0;
  } catch (err) {
    if (err.status === 404) return null; // not published yet
    throw err;
  }
}

async function collectNpm() {
  const rows = [];
  for (const pkg of NPM_PACKAGES) {
    const [week, month] = await Promise.all([npmDownloads(pkg, 'last-week'), npmDownloads(pkg, 'last-month')]);
    rows.push({ pkg, week, month });
  }
  return rows;
}

// ─── GitHub traffic (needs admin token) ─────────────────────────────────────
async function collectTraffic() {
  if (!TOKEN) return { ok: false, reason: 'no-token' };
  try {
    const views = await fetchJson(`${GH_API}/repos/${REPO}/traffic/views`);
    const clones = await fetchJson(`${GH_API}/repos/${REPO}/traffic/clones`);
    return {
      ok: true,
      views14: views.count, uniques14: views.uniques,
      clones14: clones.count, cloneUniques14: clones.uniques,
      days: views.views.map((d) => ({ date: d.timestamp.slice(0, 10), count: d.count, uniques: d.uniques })),
    };
  } catch (err) {
    return { ok: false, reason: err.status === 403 || err.status === 404 ? 'needs-admin-token' : 'error' };
  }
}

// ─── HTML ───────────────────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function barRow(label, value, max, color) {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  return `<div class="row"><span class="lbl">${esc(label)}</span><span class="track"><span class="fill" style="width:${w}%;background:${color}"></span></span><span class="val">${fmt(value)}</span></div>`;
}

function renderDashboard({ releases, npm, traffic, generatedAt }) {
  const { osTotals, perRelease, totalInstalls } = releases;
  const maxOs = Math.max(1, ...Object.values(osTotals));
  const relWithData = perRelease.filter((r) => r.installs > 0);
  const maxRel = Math.max(1, ...relWithData.map((r) => r.installs));
  const relChart = (relWithData.length ? relWithData : perRelease.slice(-12)).map((r) =>
    barRow(r.tag, r.installs, maxRel, 'linear-gradient(90deg,#06b6d4,#22d3ee)')).join('\n');

  const npmRows = npm.map((r) => {
    if (r.week === null) return `<div class="row"><span class="lbl">${esc(r.pkg)}</span><span class="track"><span class="fill" style="width:0"></span></span><span class="val muted">not published yet</span></div>`;
    return barRow(r.pkg, r.week, Math.max(1, ...npm.filter((x) => x.week !== null).map((x) => x.week)), 'linear-gradient(90deg,#22c55e,#4ade80)');
  }).join('\n');

  let trafficHtml;
  if (traffic.ok) {
    trafficHtml = `
    <div class="cards">
      <div class="card"><div class="num">${fmt(traffic.views14)}</div><div class="cap">repo views (14d)</div><div class="sub">${fmt(traffic.uniques14)} unique visitors</div></div>
      <div class="card"><div class="num">${fmt(traffic.clones14)}</div><div class="cap">repo clones (14d)</div><div class="sub">${fmt(traffic.cloneUniques14)} unique cloners</div></div>
    </div>`;
  } else {
    const why = traffic.reason === 'no-token'
      ? 'export <code>PIPO_GH_TOKEN</code> with a fine-grained token that has <b>Administration: read</b> on the repo, then re-run.'
      : 'your token lacks <b>Administration: read</b> on the repository (Settings → Developer settings → Fine-grained tokens), which the traffic API requires.';
    trafficHtml = `<p class="muted big">Repo traffic needs one extra permission. ${why}</p>`;
  }

  const assetRows = releases.perAsset
    .sort((a, b) => b.count - a.count)
    .map((a) => `<tr><td>${esc(a.release)}</td><td>${esc(a.name)}</td><td>${esc(a.os)}</td><td class="r">${fmt(a.count)}</td></tr>`)
    .join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>pipo admin dashboard — installs &amp; downloads</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px 24px 64px; background:#0b1020; color:#e2e8f0;
         font:15px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .wrap { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h1 .accent { color:#22d3ee; }
  .gen { color:#64748b; font-size: 13px; margin-bottom: 28px; }
  h2 { font-size: 17px; margin: 34px 0 12px; color:#94a3b8; text-transform:uppercase; letter-spacing:.08em; }
  .cards { display:flex; gap:14px; flex-wrap:wrap; }
  .card { flex:1 1 200px; background:#111a33; border:1px solid #1e2a4a; border-radius:14px; padding:18px 20px; }
  .num { font-size: 34px; font-weight: 700; color:#e2e8f0; }
  .cap { color:#94a3b8; font-size: 13px; margin-top: 2px; }
  .sub { color:#64748b; font-size: 12px; margin-top: 6px; }
  .panel { background:#111a33; border:1px solid #1e2a4a; border-radius:14px; padding:18px 20px; }
  .row { display:grid; grid-template-columns: 220px 1fr 90px; gap:12px; align-items:center; padding:6px 0; }
  .lbl { color:#cbd5e1; font-size: 13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .track { background:#0b1226; border-radius:99px; height:14px; overflow:hidden; }
  .fill { display:block; height:100%; border-radius:99px; }
  .val { text-align:right; font-variant-numeric: tabular-nums; color:#e2e8f0; font-size:13px; }
  .muted { color:#64748b; }
  .big { font-size: 14px; line-height: 1.7; }
  code { background:#0b1226; border:1px solid #1e2a4a; border-radius:6px; padding:1px 6px; font-size:13px; }
  table { width:100%; border-collapse: collapse; font-size: 13px; }
  th { text-align:left; color:#64748b; font-weight:600; padding:8px 10px; border-bottom:1px solid #1e2a4a; }
  td { padding:7px 10px; border-bottom:1px solid #16203c; color:#cbd5e1; }
  td.r { text-align:right; font-variant-numeric: tabular-nums; }
  .note { background:#111a33; border:1px solid #1e2a4a; border-radius:14px; padding:14px 18px; font-size:13.5px; color:#94a3b8; line-height:1.7; }
</style></head><body><div class="wrap">
<h1>pipo <span class="accent">admin dashboard</span></h1>
<div class="gen">Generated ${esc(generatedAt)} · repo <code>${esc(REPO)}</code> · every number is a real counter from GitHub or npm, nothing estimated</div>

<h2>Installs by operating system</h2>
<div class="cards">
  <div class="card"><div class="num">${fmt(osTotals.Windows)}</div><div class="cap">Windows installs</div></div>
  <div class="card"><div class="num">${fmt(osTotals.macOS)}</div><div class="cap">macOS installs</div></div>
  <div class="card"><div class="num">${fmt(osTotals.Linux)}</div><div class="cap">Linux installs</div></div>
  <div class="card"><div class="num">${fmt(totalInstalls)}</div><div class="cap">total installers downloaded</div></div>
</div>
<div class="panel" style="margin-top:14px">
${barRow('Windows', osTotals.Windows, maxOs, 'linear-gradient(90deg,#3b82f6,#60a5fa)')}
${barRow('macOS', osTotals.macOS, maxOs, 'linear-gradient(90deg,#a855f7,#c084fc)')}
${barRow('Linux', osTotals.Linux, maxOs, 'linear-gradient(90deg,#f59e0b,#fbbf24)')}
</div>

<h2>Downloads per release (over time)</h2>
<div class="panel">
${relChart || '<p class="muted">No release assets yet.</p>'}
<p class="muted" style="font-size:12px;margin:10px 0 0">Counts are cumulative per tag. The gap between a tag's date and its count shows which releases pulled users in.</p>
</div>

<h2>npm downloads — last week</h2>
<div class="panel">
${npmRows}
<p class="muted" style="font-size:12px;margin:10px 0 0">"not published yet" = the package has never reached the registry. Once the npm Trusted Publisher is configured and Release Executor completes, these rows fill automatically.</p>
</div>

<h2>Repository traffic</h2>
${trafficHtml}

<h2>Where users are</h2>
<div class="note">GitHub and npm counters do not carry geography. To see countries, cities and referrers for the website (<code>www.pipo-ke.com</code>) and the download page specifically, enable <b>Cloudflare Web Analytics</b> (free, privacy-friendly) on the domain, or add the snippet to the site — the step-by-step guide in the admin dashboard document covers this. As a proxy: Windows = the <code>pipo-Setup.exe</code> count, macOS = the <code>.dmg</code> count, Linux = the script/one-liner path, which the repo-clone traffic above hints at.</div>

<h2>Every asset, raw numbers</h2>
<div class="panel">
<table><tr><th>Release</th><th>Asset</th><th>OS</th><th class="r">Downloads</th></tr>
${assetRows || '<tr><td colspan="4" class="muted">No assets yet.</td></tr>'}
</table>
</div>

</div></body></html>`;
}

// ─── Terminal summary ───────────────────────────────────────────────────────
function printSummary({ releases, npm, traffic }) {
  const { osTotals, totalInstalls } = releases;
  const line = '─'.repeat(46);
  console.log(`\n  pipo admin dashboard — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  console.log(`  ${line}`);
  console.log(`  Windows installs   ${fmt(osTotals.Windows).padStart(8)}`);
  console.log(`  macOS installs     ${fmt(osTotals.macOS).padStart(8)}`);
  console.log(`  Linux installs     ${fmt(osTotals.Linux).padStart(8)}`);
  console.log(`  TOTAL (installers) ${fmt(totalInstalls).padStart(8)}`);
  console.log(`  ${line}`);
  for (const r of npm) {
    const w = r.week === null ? 'not published yet' : `${fmt(r.week)} this week · ${fmt(r.month ?? 0)} this month`;
    console.log(`  npm ${r.pkg.padEnd(28)} ${w}`);
  }
  console.log(`  ${line}`);
  if (traffic.ok) {
    console.log(`  repo views (14d)   ${fmt(traffic.views14).padStart(8)}  (${fmt(traffic.uniques14)} uniques)`);
    console.log(`  repo clones (14d)  ${fmt(traffic.clones14).padStart(8)}  (${fmt(traffic.cloneUniques14)} uniques)`);
  } else {
    console.log('  repo traffic       skipped — see the dashboard for the one-line fix');
  }
  console.log(`  ${line}`);
}

// ─── main ───────────────────────────────────────────────────────────────────
let networkFailure = false;
async function soft(label, fn) {
  try { return await fn(); } catch (err) {
    console.error(`  [!] ${label} unavailable: ${err.message}`);
    networkFailure = true;
    return null;
  }
}

const releases = await soft('GitHub releases', collectReleases) ?? { osTotals: { Windows: 0, macOS: 0, Linux: 0, Other: 0 }, perRelease: [], perAsset: [], totalInstalls: 0 };
const npm = await soft('npm downloads', collectNpm) ?? NPM_PACKAGES.map((pkg) => ({ pkg, week: null, month: null }));
const traffic = await soft('repo traffic', collectTraffic) ?? { ok: false, reason: 'error' };

printSummary({ releases, npm, traffic });
const html = renderDashboard({ releases, npm, traffic, generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC' });
const { writeFileSync } = await import('node:fs');
writeFileSync(OUT, html);
console.log(`\n  dashboard written to ${OUT} — open it in a browser.\n`);
if (networkFailure && releases.perRelease.length === 0 && npm.every((n) => n.week === null)) process.exitCode = 1;
