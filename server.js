// server.js
// Full "Ubersuggest-like" single-file backend (simulated + scraping + intelligent heuristics)
// Requirements: node >= 14, run `npm install express axios cheerio cors`
// Run: node server.js

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const { URL } = require('url');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const path = require('path');

// Serve frontend files (IMPORTANT for Railway)
app.use(express.static(__dirname));
app.use(express.static("public"));

// ------------ CONFIG ------------
const PORT = process.env.PORT || 3000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SEO-Analyzer-Bot/1.0';
const SAFE_TIMEOUT = 10000; // ms

// ------------ In-memory stores (simulated DB) ------------
const PROJECTS = []; // { id, domain, createdAt, settings }
const RANKS = {};    // { projectId: [{keyword, date, pos, device, country}] }
const BACKLINKS = {}; // { domain: [{source, target, anchor, createdAt, status}] }
const SAVED_KEYWORDS = {}; // { projectId: [keywordStrings] }
// simple id generator
const id = (prefix = '') => prefix + Math.random().toString(36).slice(2, 9);

// ------------ Utilities ------------
function safeGet(url, opts = {}) {
  return axios.get(url, {
    timeout: SAFE_TIMEOUT,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
    ...opts
  });
}

function safeHead(url) {
  return axios.head(url, { timeout: 8000, headers: { 'User-Agent': USER_AGENT }, maxRedirects: 5 });
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function sample(arr, n = 1) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const out = [];
  const copy = arr.slice();
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

// naive syllable count (quick)
function countSyllables(word) {
  word = (word || '').toLowerCase();
  if (!word) return 0;
  if (word.length <= 3) return 1;
  const cleaned = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  const matches = cleaned.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

// Keyword suggestion heuristics
const SUG_MODIFIERS = [
  'best', 'top', 'cheap', 'buy', 'how to', 'what is', 'vs', 'near me', 'guide', '2025', 'example', 'free'
];

function genRelatedKeywords(keyword, n = 12) {
  const parts = keyword.split(/\s+/).slice(0,3);
  const base = parts.join(' ');
  const out = new Set();
  out.add(base);
  for (let i = 0; out.size < n; i++) {
    const mod = SUG_MODIFIERS[i % SUG_MODIFIERS.length];
    const form = Math.random() > 0.6 ? `${mod} ${base}` : `${base} ${mod}`;
    out.add(form);
    if (Math.random() > 0.7) out.add(base + ' ' + Math.random().toString(36).slice(2,5));
  }
  return Array.from(out).slice(0, n);
}

// Simple trend generator (12 months)
function genTrend(baseVol = 1000) {
  const trend = [];
  for (let i = 0; i < 12; i++) {
    const noise = Math.round(baseVol * (0.6 + Math.random() * 0.9));
    trend.push(noise);
  }
  return trend;
}

// Basic SERP fetcher (scrape top results titles/snippets) - best-effort
async function fetchSERP(keyword) {
  // Note: Google blocks automated scraping. We'll try Bing as fallback via search query results page.
  const q = encodeURIComponent(keyword);
  const urls = [
    `https://www.bing.com/search?q=${q}`,
    `https://html.duckduckgo.com/html?q=${q}`
  ];
  for (const url of urls) {
    try {
      const res = await safeGet(url);
      const $ = cheerio.load(res.data);
      // Bing selectors
      const results = [];
      $('li.b_algo').each((i, el) => {
        const title = $(el).find('h2').text().trim();
        const link = $(el).find('h2 a').attr('href') || '';
        const snippet = $(el).find('.b_caption p').text().trim();
        if (title && link) results.push({ position: results.length + 1, title, link, snippet });
      });
      if (results.length) return results.slice(0, 10);
      // DuckDuckGo fallback
      $('.result__body').each((i, el) => {
        const title = $(el).find('.result__title').text().trim();
        const link = $(el).find('.result__a').attr('href') || '';
        const snippet = $(el).find('.result__snippet').text().trim();
        if (title && link) results.push({ position: results.length + 1, title, link, snippet });
      });
      if (results.length) return results.slice(0, 10);
    } catch (e) {
      // continue to next
    }
  }
  // fallback: simulated SERP
  return Array.from({length:10}).map((_,i) => ({
    position: i+1,
    title: `${keyword} - Example result ${i+1}`,
    link: `https://example.com/${keyword.replace(/\s+/g,'-')}/page${i+1}`,
    snippet: `This is a simulated snippet for ${keyword} result ${i+1}.`
  }));
}

// ------------ Basic routes ------------
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/keyword', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'keyword.html'));
});

// ------------ API Endpoints ------------

// Basic health
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', ts: new Date().toISOString() });
});

// SEO: title, description, h1
app.get('/api/seo', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    const r = await safeGet(url);
    const $ = cheerio.load(r.data);
    const title = $('title').text() || null;
    const description = $('meta[name="description"]').attr('content') || null;
    const h1 = $('h1').first().text() || null;
    res.json({ title, description, h1, status: 'success' });
  } catch (err) {
    res.json({ error: 'Failed to fetch', details: err.message });
  }
});

// Broken links (check A, IMG, LINK, SCRIPT)
app.get('/api/broken-links', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    const r = await safeGet(url);
    const $ = cheerio.load(r.data);
    const origin = new URL(url).origin;
    let links = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      let abs = href;
      if (abs.startsWith('//')) abs = 'http:' + abs;
      if (!abs.startsWith('http')) abs = new URL(abs, url).href;
      links.push(abs);
    });
    $('img[src]').each((i, el) => {
      let src = $(el).attr('src');
      if (!src) return;
      if (src.startsWith('//')) src = 'http:' + src;
      if (!src.startsWith('http')) src = new URL(src, url).href;
      links.push(src);
    });
    $('link[href], script[src]').each((i, el) => {
      const href = $(el).attr('href') || $(el).attr('src');
      if (!href) return;
      let abs = href;
      if (abs.startsWith('//')) abs = 'http:' + abs;
      if (!abs.startsWith('http')) abs = new URL(abs, url).href;
      links.push(abs);
    });
    links = [...new Set(links)].slice(0, 40);
    const broken = [];
    await Promise.all(links.map(async link => {
      try {
        await safeHead(link);
      } catch (e) {
        if (e.response && e.response.status >= 400) broken.push({ link, status: e.response.status });
        else broken.push({ link, status: 'Timeout/Err' });
      }
    }));
    res.json({ totalChecked: links.length, broken, status: 'success' });
  } catch (err) {
    res.json({ error: 'Failed to check', details: err.message });
  }
});

// meta audit
app.get('/api/meta', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    const r = await safeGet(url);
    const $ = cheerio.load(r.data);
    const metas = {};
    $('meta').each((i, el) => {
      const name = $(el).attr('name') || $(el).attr('property') || `meta${i}`;
      metas[name] = $(el).attr('content') || null;
    });
    const common = ['description', 'keywords', 'robots', 'author', 'viewport', 'og:title', 'og:description'];
    const missing = common.filter(c => !Object.keys(metas).some(k => k.toLowerCase() === c));
    res.json({ metas, missing, status: 'success' });
  } catch (err) {
    res.json({ error: 'Failed to fetch', details: err.message });
  }
});

// image alt check
app.get('/api/alts', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    const r = await safeGet(url);
    const $ = cheerio.load(r.data);
    const imgs = [];
    $('img').each((i, el) => {
      imgs.push({ src: $(el).attr('src') || null, alt: $(el).attr('alt') || null });
    });
    const missing = imgs.filter(i => !i.alt || i.alt.trim() === '');
    res.json({ total: imgs.length, missing, sample: imgs.slice(0,10), status: 'success' });
  } catch (err) {
    res.json({ error: 'Failed', details: err.message });
  }
});

// robots
app.get('/api/robots', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    const origin = new URL(url).origin;
    const r = await safeGet(origin + '/robots.txt');
    res.json({ robots: r.data, status: 'success' });
  } catch (err) {
    res.json({ error: 'robots.txt not found', details: err.message, status: 'error' });
  }
});

// sitemap
app.get('/api/sitemap', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    const origin = new URL(url).origin;
    const r = await safeGet(origin + '/sitemap.xml');
    const xml = r.data;
    const urls = (xml.match(/<loc>(.*?)<\/loc>/g) || []).map(s => s.replace(/<loc>|<\/loc>/g,'')).slice(0, 200);
    res.json({ total: urls.length, urls: urls.slice(0,50), status: 'success' });
  } catch (err) {
    res.json({ error: 'sitemap not found', details: err.message, status: 'error' });
  }
});

// page speed (basic)
app.get('/api/pagespeed', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    const start = Date.now();
    const r = await safeGet(url);
    const end = Date.now();
    const loadMs = end - start;
    const size = Buffer.byteLength(r.data, 'utf8');
    const $ = cheerio.load(r.data);
    const resources = $('img, link, script').length;
    res.json({ load_ms: loadMs, size_bytes: size, resources, status: 'success' });
  } catch (err) {
    res.json({ error: 'pagespeed failed', details: err.message });
  }
});

// links report
app.get('/api/links-report', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    const origin = new URL(url).origin;
    const r = await safeGet(url);
    const $ = cheerio.load(r.data);
    const internal = new Set();
    const external = new Set();
    $('a[href]').each((i, el) => {
      let href = $(el).attr('href');
      if (!href) return;
      if (href.startsWith('/')) internal.add(origin + href);
      else if (href.startsWith('http')) {
        if (href.startsWith(origin)) internal.add(href);
        else external.add(href);
      }
    });
    res.json({
      internal: Array.from(internal).slice(0,50),
      external: Array.from(external).slice(0,50),
      internal_count: internal.size,
      external_count: external.size,
      status: 'success'
    });
  } catch (err) {
    res.json({ error: 'links report failed', details: err.message });
  }
});

// headings
app.get('/api/headings', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    const r = await safeGet(url);
    const $ = cheerio.load(r.data);
    const headings = {};
    for (let i=1;i<=6;i++){
      headings['h'+i] = $('h'+i).map((_,el)=>$(el).text().trim().substring(0,200)).get();
    }
    res.json({ headings, status: 'success' });
  } catch (err) {
    res.json({ error: 'headings failed', details: err.message });
  }
});

// wordcount & readability (basic flesch)
app.get('/api/wordcount', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    const r = await safeGet(url);
    const $ = cheerio.load(r.data);
    $('script, style, nav, footer').remove();
    const text = $('body').text().replace(/\s+/g,' ').trim();
    const sentences = text.split(/[.!?]+/).filter(s => s.trim());
    const words = text.split(/\s+/).filter(w => w.trim());
    let syllables = 0;
    for (const w of words.slice(0,500)) syllables += countSyllables(w);
    const ASL = words.length / Math.max(sentences.length,1);
    const ASW = syllables / Math.max(words.length,1);
    const flesch = Math.round(206.835 - 1.015 * ASL - 84.6 * ASW);
    res.json({ words: words.length, sentences: sentences.length, flesch_reading_score: clamp(flesch,0,100), read_time_min: Math.ceil(words.length/200), status: 'success' });
  } catch (err) {
    res.json({ error: 'wordcount failed', details: err.message });
  }
});

// keywords extraction (basic freq)
app.get('/api/keywords', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    const r = await safeGet(url);
    const $ = cheerio.load(r.data);
    $('script, style').remove();
    const text = $('body').text().replace(/\s+/g,' ').toLowerCase();
    const words = text.split(/\s+/).map(w=>w.replace(/[^a-z0-9]/g,'')).filter(w=>w && w.length>3);
    const freq = {};
    for (const w of words) freq[w] = (freq[w]||0)+1;
    const sorted = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,50);
    res.json({ keywords: sorted, status: 'success' });
  } catch (err) {
    res.json({ error: 'keywords failed', details: err.message });
  }
});

// tech detection (very basic)
app.get('/api/tech', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    const r = await safeGet(url);
    const html = r.data;
    const $ = cheerio.load(html);
    const tech = { cms: null, frameworks: [], hosting: null };
    const metaGen = $('meta[name="generator"]').attr('content');
    if (metaGen) tech.cms = metaGen;
    if (html.includes('wp-content')||html.includes('wp-includes')) tech.cms='WordPress';
    if (html.includes('shopify.com') || $('link[href*="shopify.com"]').length) tech.cms='Shopify';
    const scripts = $('script[src]').map((_,el)=>$(el).attr('src')).get();
    if (html.includes('react') || scripts.some(s=>s && s.includes('react'))) tech.frameworks.push('React');
    if (html.includes('vue') || scripts.some(s=>s && s.includes('vue'))) tech.frameworks.push('Vue.js');
    if (html.includes('jquery') || scripts.some(s=>s && s.includes('jquery'))) tech.frameworks.push('jQuery');
    if (r.headers && r.headers.server) tech.hosting = r.headers.server;
    res.json({ tech, status: 'success' });
  } catch (err) {
    res.json({ error: 'tech detection failed', details: err.message });
  }
});

// full audit
app.get('/api/all', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'URL missing' });
  try {
    // call local endpoints (but avoid calling through network to improve speed)
    const calls = await Promise.allSettled([
      safeGet(`http://localhost:${PORT}/api/seo?url=${encodeURIComponent(url)}`).catch(e=>({data:{error:'localcall'}})),
      safeGet(`http://localhost:${PORT}/api/meta?url=${encodeURIComponent(url)}`).catch(e=>({data:{error:'localcall'}})),
      safeGet(`http://localhost:${PORT}/api/alts?url=${encodeURIComponent(url)}`).catch(e=>({data:{error:'localcall'}})),
      safeGet(`http://localhost:${PORT}/api/headings?url=${encodeURIComponent(url)}`).catch(e=>({data:{error:'localcall'}})),
      safeGet(`http://localhost:${PORT}/api/wordcount?url=${encodeURIComponent(url)}`).catch(e=>({data:{error:'localcall'}})),
      safeGet(`http://localhost:${PORT}/api/keywords?url=${encodeURIComponent(url)}`).catch(e=>({data:{error:'localcall'}})),
      safeGet(`http://localhost:${PORT}/api/links-report?url=${encodeURIComponent(url)}`).catch(e=>({data:{error:'localcall'}})),
      safeGet(`http://localhost:${PORT}/api/broken-links?url=${encodeURIComponent(url)}`).catch(e=>({data:{error:'localcall'}})),
      safeGet(`http://localhost:${PORT}/api/sitemap?url=${encodeURIComponent(url)}`).catch(e=>({data:{error:'localcall'}})),
      safeGet(`http://localhost:${PORT}/api/robots?url=${encodeURIComponent(url)}`).catch(e=>({data:{error:'localcall'}})),
      safeGet(`http://localhost:${PORT}/api/pagespeed?url=${encodeURIComponent(url)}`).catch(e=>({data:{error:'localcall'}})),
      safeGet(`http://localhost:${PORT}/api/tech?url=${encodeURIComponent(url)}`).catch(e=>({data:{error:'localcall'}}))
    ]);
    // craft result object
    const resObj = {};
    const keys = ['seo','meta','alts','headings','wordcount','keywords','links-report','broken-links','sitemap','robots','pagespeed','tech'];
    for (let i=0;i<calls.length;i++){
      if (calls[i].status === 'fulfilled' && calls[i].value && calls[i].value.data) resObj[keys[i]] = calls[i].value.data;
      else resObj[keys[i]] = { error: 'Check failed' };
    }
    res.json(resObj);
  } catch (err) {
    res.json({ error: 'full audit failed', details: err.message });
  }
});

// ------------ NEW: Keyword Research Endpoints ------------

// Keyword overview
app.get('/api/keyword/overview', async (req, res) => {
  const keyword = (req.query.keyword || '').trim();
  if (!keyword) return res.json({ error: 'keyword missing' });
  try {
    const baseVol = randomInt(200, 50000);
    const overview = {
      keyword,
      volume: baseVol,
      cpc: (Math.random()*5).toFixed(2),
      competition: (Math.random()).toFixed(2),
      seo_difficulty: randomInt(5, 90),
      paid_difficulty: randomInt(5, 90),
      trend: genTrend(baseVol),
      serp: await fetchSERP(keyword)
    };
    res.json(overview);
  } catch (err) {
    res.json({ error: 'keyword overview failed', details: err.message });
  }
});

// Keyword suggestions
app.get('/api/keyword/suggestions', async (req, res) => {
  const keyword = (req.query.keyword || '').trim();
  if (!keyword) return res.json({ error: 'keyword missing' });
  try {
    const suggestions = genRelatedKeywords(keyword, 20).map(k => {
      const vol = randomInt(50, 60000);
      return { keyword: k, volume: vol, cpc: (Math.random()*4).toFixed(2), difficulty: randomInt(1,90), trend: genTrend(vol) };
    });
    res.json({ keyword, suggestions });
  } catch (err) {
    res.json({ error: 'keyword suggestions failed', details: err.message });
  }
});

// Keyword questions (who/what/how/why)
app.get('/api/keyword/questions', async (req, res) => {
  const keyword = (req.query.keyword || '').trim();
  if (!keyword) return res.json({ error: 'keyword missing' });
  const questionPref = ['how', 'what', 'why', 'when', 'where', 'can', 'is', 'which'];
  const questions = questionPref.slice(0,6).map(q => `${q} ${keyword}?`);
  res.json({ keyword, questions, status: 'success' });
});

// Keyword comparisons (a vs b)
app.get('/api/keyword/comparisons', async (req, res) => {
  const keywords = (req.query.keywords || '').split(',').map(k=>k.trim()).filter(Boolean);
  if (!keywords.length) return res.json({ error: 'keywords param missing (comma separated)' });
  const comps = keywords.map(k => ({
    keyword: k,
    volume: randomInt(100,50000),
    difficulty: randomInt(1,100),
    cpc: (Math.random()*5).toFixed(2),
    trend: genTrend(randomInt(50,20000))
  }));
  res.json({ comparisons: comps });
});

// Keyword prepositions (e.g., "keyword for", "keyword with")
app.get('/api/keyword/prepositions', async (req, res) => {
  const keyword = (req.query.keyword || '').trim();
  if (!keyword) return res.json({ error: 'keyword missing' });
  const preps = ['for', 'with', 'without', 'near me', 'vs', 'and', 'or'];
  const list = preps.map(p => `${keyword} ${p}`).slice(0,10);
  res.json({ keyword, list });
});

// Keyword SERP (top results)
app.get('/api/keyword/serp', async (req, res) => {
  const keyword = (req.query.keyword || '').trim();
  if (!keyword) return res.json({ error: 'keyword missing' });
  try {
    const serp = await fetchSERP(keyword);
    res.json({ keyword, serp });
  } catch (err) {
    res.json({ error: 'serp fetch failed', details: err.message });
  }
});

// ------------ NEW: Backlink Module (simulated + simple heuristics) ------------

// generate sample backlink entries for a domain
function genBacklinksFor(domain, n = 20) {
  const out = [];
  for (let i=0;i<n;i++){
    const src = `https://site${randomInt(1,500)}.example.com/${id('p')}`;
    out.push({
      id: id('b'),
      source: src,
      target: `https://${domain}/${id('t')}`,
      anchor: sample(['click here','learn more','read more','official','homepage','article'])[0],
      domain_authority: randomInt(10,90),
      createdAt: new Date(Date.now() - randomInt(0,60)*24*3600*1000).toISOString(),
      status: 'active'
    });
  }
  return out;
}

// get backlinks for domain
app.get('/api/backlinks', async (req, res) => {
  const domain = (req.query.domain || '').replace(/^https?:\/\//,'').replace(/\/.*/,'').trim();
  if (!domain) return res.json({ error: 'domain missing' });
  if (!BACKLINKS[domain]) BACKLINKS[domain] = genBacklinksFor(domain, randomInt(10,40));
  const list = BACKLINKS[domain].slice(0,200);
  // summary
  const referring_domains = new Set(list.map(l => {
    try { return new URL(l.source).hostname; } catch(e){ return l.source.split('/')[2]||l.source; }
  }));
  res.json({ domain, total_backlinks: list.length, referring_domains_count: referring_domains.size, backlinks: list });
});

// new backlinks (simulate new/added)
app.get('/api/backlinks/new', (req,res) => {
  const domain = (req.query.domain || '').replace(/^https?:\/\//,'').replace(/\/.*/,'').trim();
  if (!domain) return res.json({ error: 'domain missing' });
  const newLinks = genBacklinksFor(domain, randomInt(1,6));
  BACKLINKS[domain] = (BACKLINKS[domain] || []).concat(newLinks);
  res.json({ domain, added: newLinks.length, new_backlinks: newLinks });
});

// lost backlinks (simulate some removed)
app.get('/api/backlinks/lost', (req,res) => {
  const domain = (req.query.domain || '').replace(/^https?:\/\//,'').replace(/\/.*/,'').trim();
  if (!domain) return res.json({ error: 'domain missing' });
  if (!BACKLINKS[domain]) BACKLINKS[domain] = genBacklinksFor(domain, randomInt(10,40));
  // mark some as lost
  const lost = sample(BACKLINKS[domain], Math.min(5, BACKLINKS[domain].length));
  lost.forEach(l => l.status = 'lost');
  res.json({ domain, lost: lost.map(l=>({id:l.id,source:l.source})), total_lost: lost.length });
});

// backlink domains (referring domains breakdown)
app.get('/api/backlinks/domains', (req,res) => {
  const domain = (req.query.domain || '').replace(/^https?:\/\//,'').replace(/\/.*/,'').trim();
  if (!domain) return res.json({ error: 'domain missing' });
  if (!BACKLINKS[domain]) BACKLINKS[domain] = genBacklinksFor(domain, 25);
  const map = {};
  BACKLINKS[domain].forEach(b => {
    const hostname = (() => { try { return new URL(b.source).hostname } catch(e){ return b.source.split('/')[2]||b.source; }})();
    map[hostname] = (map[hostname]||0) + 1;
  });
  const domains = Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([d,c])=>({domain:d,count:c}));
  res.json({ domain, referring_domains: domains.slice(0,50) });
});

// backlink anchors
app.get('/api/backlinks/anchors', (req,res) => {
  const domain = (req.query.domain || '').replace(/^https?:\/\//,'').replace(/\/.*/,'').trim();
  if (!domain) return res.json({ error: 'domain missing' });
  if (!BACKLINKS[domain]) BACKLINKS[domain] = genBacklinksFor(domain, 25);
  const anchors = {};
  BACKLINKS[domain].forEach(b => { anchors[b.anchor] = (anchors[b.anchor]||0)+1; });
  res.json({ domain, anchors: Object.entries(anchors).sort((a,b)=>b[1]-a[1]).map(x=>({anchor:x[0],count:x[1]})).slice(0,50) });
});

// ------------ NEW: Rank Tracking (in-memory) ------------

// add rank entry (projectId required)
app.post('/api/rank/add', (req,res) => {
  const { projectId, keyword, position, device='desktop', country='global' } = req.body || {};
  if (!projectId || !keyword) return res.json({ error: 'projectId and keyword required' });
  if (!RANKS[projectId]) RANKS[projectId] = [];
  const entry = { id: id('r'), keyword, position: position||randomInt(1,100), device, country, date: new Date().toISOString() };
  RANKS[projectId].push(entry);
  res.json({ added: entry });
});

// list rank entries for project
app.get('/api/rank/list', (req,res) => {
  const projectId = req.query.projectId;
  if (!projectId) return res.json({ error: 'projectId missing' });
  res.json({ projectId, ranks: RANKS[projectId] || [] });
});

// get today's snapshot (simulated)
app.get('/api/rank/today', (req,res) => {
  const projectId = req.query.projectId;
  if (!projectId) return res.json({ error: 'projectId missing' });
  const keywords = (SAVED_KEYWORDS[projectId] || []).slice(0,30);
  const snapshot = keywords.map(k => ({ keyword: k, position: randomInt(1,100), device: 'desktop', date: new Date().toISOString() }));
  res.json({ projectId, snapshot });
});

// history for a keyword in project
app.get('/api/rank/history', (req,res) => {
  const { projectId, keyword } = req.query;
  if (!projectId || !keyword) return res.json({ error: 'projectId & keyword required' });
  // produce 30 days simulated history
  const hist = [];
  let pos = randomInt(1,100);
  for (let i=30;i>=0;i--){
    pos = clamp(pos + randomInt(-3,3), 1, 200);
    hist.push({ date: new Date(Date.now() - i*24*3600*1000).toISOString().slice(0,10), position: pos });
  }
  res.json({ projectId, keyword, history: hist });
});

// ------------ NEW: Competitor Analysis (simulated) ------------

// competitor overview
app.get('/api/competitor/overview', async (req,res) => {
  const domain = (req.query.domain || '').replace(/^https?:\/\//,'').replace(/\/.*/,'').trim();
  if (!domain) return res.json({ error: 'domain missing' });
  // simulated metrics
  const overview = {
    domain,
    estimated_visitors_month: randomInt(1000, 500000),
    domain_authority: randomInt(10, 90),
    top_keywords: genRelatedKeywords(domain.replace(/\./g,' '), 8).map(k => ({ keyword: k, pos: randomInt(1,50), volume: randomInt(50,20000) })),
    top_pages: [
      { url: `https://${domain}/`, title: 'Homepage', visits: randomInt(100,5000) },
      { url: `https://${domain}/blog`, title: 'Blog', visits: randomInt(50,3000) }
    ]
  };
  res.json(overview);
});

// top pages
app.get('/api/competitor/top-pages', (req,res) => {
  const domain = (req.query.domain || '').replace(/^https?:\/\//,'').replace(/\/.*/,'').trim();
  if (!domain) return res.json({ error:'domain missing' });
  const pages = Array.from({length:randomInt(3,10)}).map((_,i)=>({
    url: `https://${domain}/page${i+1}`,
    title: `Top page ${i+1}`,
    visits: randomInt(100,20000),
    backlinks: randomInt(0,500)
  }));
  res.json({ domain, pages });
});

// top keywords
app.get('/api/competitor/top-keywords', (req,res) => {
  const domain = (req.query.domain || '').replace(/^https?:\/\//,'').replace(/\/.*/,'').trim();
  const kws = genRelatedKeywords(domain, 12).map(k=>({ keyword: k, volume: randomInt(50,20000), position: randomInt(1,50) }));
  res.json({ domain, keywords: kws });
});

// competitor traffic estimate
app.get('/api/competitor/traffic', (req,res) => {
  const domain = (req.query.domain || '').replace(/^https?:\/\//,'').replace(/\/.*/,'').trim();
  res.json({ domain, monthly_visitors: randomInt(1000,500000), pages_per_visit: (Math.random()*3+1).toFixed(2), bounce_rate: (Math.random()*60+10).toFixed(1) });
});

// keyword gap between two domains
app.get('/api/competitor/gap-keywords', (req,res) => {
  const a = (req.query.a || '').trim();
  const b = (req.query.b || '').trim();
  if (!a || !b) return res.json({ error: 'a and b domains required' });
  const gap = genRelatedKeywords(`${a} ${b}`, 20).map(k=>({ keyword: k, volume: randomInt(20,20000) }));
  res.json({ a, b, gap });
});

// backlink gap
app.get('/api/competitor/gap-backlinks', (req,res) => {
  const a = (req.query.a || '').trim();
  const b = (req.query.b || '').trim();
  if (!a || !b) return res.json({ error: 'a and b domains required' });
  // simulated opportunities
  const opp = genBacklinksFor(b.replace(/^https?:\/\//,''), 10).slice(0,10);
  res.json({ a, b, opportunities: opp });
});

// ------------ NEW: Content Analyzer ------------

// content scoring: length, keyword density, readability, suggestions
app.post('/api/content/score', async (req,res) => {
  const { html, keyword } = req.body || {};
  if (!html && !req.body.text) return res.json({ error: 'Provide html or text' });
  const text = (req.body.text || '').trim() || (function(){ const $ = cheerio.load(html); return $('body').text().replace(/\s+/g,' ').trim(); })();
  const words = text.split(/\s+/).filter(Boolean);
  const len = words.length;
  const sentences = text.split(/[.!?]+/).filter(Boolean).length || 1;
  let syllables = 0;
  for (const w of words.slice(0,500)) syllables += countSyllables(w);
  const ASL = len / sentences;
  const ASW = syllables / Math.max(len,1);
  const flesch = Math.round(206.835 - 1.015 * ASL - 84.6 * ASW);
  const keywordCount = keyword ? (text.match(new RegExp(keyword,'gi')) || []).length : 0;
  const density = keyword ? Number(((keywordCount / Math.max(len,1)) * 100).toFixed(3)) : 0;
  const score = clamp(Math.round((flesch/100)*40 + Math.min(30, len/10) + (density>0?20:0)), 1, 100);
  res.json({ words: len, flesch, density_percent: density, keyword_count: keywordCount, score, suggestions: [
    len < 800 ? 'Increase article length to 800+ words for better competitiveness' : 'Length looks good',
    flesch < 50 ? 'Make sentences shorter for better readability' : 'Readability looks good',
    density > 2 ? 'Reduce keyword density to avoid stuffing' : 'Keyword density OK'
  ]});
});

// content density
app.post('/api/content/density', (req,res) => {
  const { text, keyword } = req.body || {};
  if (!text || !keyword) return res.json({ error: 'text and keyword required' });
  const words = text.split(/\s+/).filter(Boolean);
  const len = words.length;
  const count = (text.match(new RegExp(keyword,'gi')) || []).length;
  const density = Number(((count/Math.max(len,1))*100).toFixed(3));
  res.json({ words: len, count, density });
});

// basic NLP (entities by capitalization heuristics)
app.post('/api/content/nlp', (req,res) => {
  const text = req.body.text || '';
  const tokens = text.split(/\s+/).filter(Boolean);
  const entities = {};
  tokens.forEach((t,i) => {
    if (/^[A-Z][a-z]+/.test(t) && t.length>2) entities[t] = (entities[t]||0)+1;
  });
  const sorted = Object.entries(entities).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([k,c])=>({entity:k,count:c}));
  res.json({ entities: sorted });
});

// basic plagiarism (very naive: check repeating bigrams)
app.post('/api/content/plagiarism', (req,res) => {
  const text = (req.body.text || '').replace(/\s+/g,' ').trim();
  if (!text) return res.json({ error: 'text missing' });
  const words = text.split(' ');
  const bigrams = {};
  for (let i=0;i<words.length-1;i++){
    const key = (words[i]+' '+words[i+1]).toLowerCase();
    bigrams[key] = (bigrams[key]||0)+1;
  }
  const repeats = Object.entries(bigrams).filter(([k,c])=>c>2).slice(0,20).map(([k,c])=>({ phrase: k, count: c }));
  res.json({ repeats, score: repeats.length ? clamp(100 - repeats.length*10,0,100) : 100 });
});

// content ideas (seed based)
app.post('/api/content/ideas', (req,res) => {
  const topic = (req.body.topic || '').trim();
  if (!topic) return res.json({ error: 'topic missing' });
  const ideas = [
    `10 Best ${topic} in 2025`,
    `How to use ${topic} (Beginner's Guide)`,
    `${topic} vs Alternatives: Which is Better?`,
    `Advanced ${topic} Strategies for Small Businesses`
  ];
  res.json({ topic, ideas });
});

// ------------ NEW: AI Helpers (templated, no external AI used) ------------

// AI meta (generate title + desc)
app.post('/api/ai/meta', (req,res) => {
  const { target_keyword, brand } = req.body || {};
  if (!target_keyword) return res.json({ error: 'target_keyword missing' });
  const title = `${target_keyword} - ${brand ? brand + ' | ' : ''}Complete Guide`;
  const desc = `Learn everything about ${target_keyword}. Strategies, tips and best practices to help you achieve results.`;
  res.json({ title: title.substring(0,70), description: desc.substring(0,160) });
});

// AI keywords (suggest related keywords)
app.post('/api/ai/keywords', (req,res) => {
  const seed = (req.body.seed || '').trim();
  if (!seed) return res.json({ error: 'seed missing' });
  const kws = genRelatedKeywords(seed, 25).map(k => ({ keyword: k, volume: randomInt(10,50000), difficulty: randomInt(1,90) }));
  res.json({ seed, suggestions: kws });
});

// AI fixes (analyze a small audit object and propose fixes)
app.post('/api/ai/fixes', (req,res) => {
  const audit = req.body.audit || {};
  const fixes = [];
  if (audit.seo && (!audit.seo.title || !audit.seo.description)) {
    fixes.push('Add a clear and unique title and meta description.');
  }
  if (audit.alts && audit.alts.missing && audit.alts.missing.length) {
    fixes.push('Add descriptive alt attributes for images.');
  }
  if (audit.pagespeed && audit.pagespeed.load_ms && audit.pagespeed.load_ms > 3000) {
    fixes.push('Optimize images and enable caching to reduce load time.');
  }
  if (fixes.length === 0) fixes.push('No urgent issues found. Continue monitoring.');
  res.json({ fixes });
});

// AI competitor insights (basic)
app.post('/api/ai/competitor', (req,res) => {
  const { domain } = req.body || {};
  if (!domain) return res.json({ error: 'domain missing' });
  res.json({ domain, insights: [`${domain} has strong backlinks from authority sites`, `${domain} performs well on long-tail keywords`] });
});

// AI content writer (small paragraph)
app.post('/api/ai/content', (req,res) => {
  const { topic, length=150 } = req.body || {};
  if (!topic) return res.json({ error: 'topic missing' });
  const p = `This is a concise introduction about ${topic}. ${topic} is important because it helps users understand the essentials and apply best practices.`;
  res.json({ topic, content: p.substring(0, length) });
});

// ------------ NEW: Project System (simulated) ------------

app.post('/api/project/add', (req,res) => {
  const { domain, name } = req.body || {};
  if (!domain) return res.json({ error: 'domain required' });
  const project = { id: id('p'), domain, name: name||domain, createdAt: new Date().toISOString(), settings: {} };
  PROJECTS.push(project);
  // initialize stores
  SAVED_KEYWORDS[project.id] = [];
  RANKS[project.id] = [];
  res.json({ created: project });
});

app.get('/api/project/list', (req,res) => res.json({ projects: PROJECTS }));

app.post('/api/project/delete', (req,res) => {
  const { projectId } = req.body || {};
  if (!projectId) return res.json({ error: 'projectId required' });
  const idx = PROJECTS.findIndex(p => p.id === projectId);
  if (idx === -1) return res.json({ error: 'project not found' });
  PROJECTS.splice(idx,1);
  delete SAVED_KEYWORDS[projectId];
  delete RANKS[projectId];
  res.json({ deleted: projectId });
});

// Save keywords to a project
app.post('/api/project/keywords/save', (req,res) => {
  const { projectId, keywords } = req.body || {};
  if (!projectId || !Array.isArray(keywords)) return res.json({ error: 'projectId and keywords[] required' });
  SAVED_KEYWORDS[projectId] = (SAVED_KEYWORDS[projectId] || []).concat(keywords).slice(0,5000);
  res.json({ projectId, saved_count: SAVED_KEYWORDS[projectId].length });
});

// list saved keywords
app.get('/api/project/keywords', (req,res) => {
  const projectId = req.query.projectId;
  if (!projectId) return res.json({ error: 'projectId missing' });
  res.json({ projectId, keywords: SAVED_KEYWORDS[projectId] || [] });
});

// ------------ Utilities: simple debug endpoints ------------

app.get('/api/debug/state', (req,res) => {
  res.json({ projectsCount: PROJECTS.length, ranksKeys: Object.keys(RANKS).length, backlinksKeys: Object.keys(BACKLINKS).length });
});

// ------------ 404 handler for undefined routes ------------
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

// ------------ Start server ------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Ubersuggest-like backend running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});