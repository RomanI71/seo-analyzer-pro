const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const { URL } = require('url');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Security headers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Safe HTTP request function
function safeGet(url) {
  return axios.get(url, {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
}

// Syllable counter for readability
function countSyllables(word) {
  word = word.toLowerCase().trim();
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

// ========== API ENDPOINTS ==========

// SEO Check - Title, Meta, H1
app.get('/api/seo', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const response = await safeGet(url);
    const $ = cheerio.load(response.data);
    
    const title = $('title').text() || null;
    const description = $('meta[name="description"]').attr('content') || null;
    const h1 = $('h1').first().text() || null;

    res.json({
      title,
      description,
      h1,
      status: 'success'
    });
  } catch (error) {
    res.json({ 
      error: 'Failed to analyze SEO',
      details: error.message 
    });
  }
});

// Broken Links Check
app.get('/api/broken-links', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const response = await safeGet(url);
    const $ = cheerio.load(response.data);
    
    let links = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('http')) {
        links.push(href);
      }
    });

    // Remove duplicates and check first 5 links
    links = [...new Set(links)].slice(0, 5);
    let broken = [];

    for (const link of links) {
      try {
        await safeGet(link);
      } catch (e) {
        broken.push(link);
      }
    }

    res.json({
      total: links.length,
      broken,
      status: 'success'
    });
  } catch (error) {
    res.json({ 
      error: 'Failed to check broken links',
      details: error.message 
    });
  }
});

// Meta Audit
app.get('/api/meta', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const response = await safeGet(url);
    const $ = cheerio.load(response.data);
    
    const metas = {};
    $('meta').each((i, el) => {
      const name = $(el).attr('name') || $(el).attr('property') || `meta${i}`;
      metas[name] = $(el).attr('content') || null;
    });

    const common = ['description', 'keywords', 'robots', 'author', 'viewport', 'og:title', 'og:description'];
    const missing = common.filter(c => !Object.keys(metas).some(k => k.toLowerCase() === c));

    res.json({
      metas,
      missing,
      status: 'success'
    });
  } catch (error) {
    res.json({ 
      error: 'Failed to analyze meta tags',
      details: error.message 
    });
  }
});

// Keywords Extraction
app.get('/api/keywords', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const response = await safeGet(url);
    const $ = cheerio.load(response.data);
    
    // Remove scripts and styles
    $('script, style').remove();
    
    const text = $('body').text().replace(/\s+/g, ' ').toLowerCase();
    const words = text.split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w && w.length > 3);
    
    const freq = {};
    for (const w of words) {
      freq[w] = (freq[w] || 0) + 1;
    }
    
    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    res.json({
      keywords: sorted,
      status: 'success'
    });
  } catch (error) {
    res.json({ 
      error: 'Failed to extract keywords',
      details: error.message 
    });
  }
});

// Image Alt Check
app.get('/api/alts', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const response = await safeGet(url);
    const $ = cheerio.load(response.data);
    
    const imgs = [];
    $('img').each((i, el) => {
      imgs.push({
        src: $(el).attr('src') || null,
        alt: $(el).attr('alt') || null
      });
    });

    const missing = imgs.filter(i => !i.alt || i.alt.trim() === '');

    res.json({
      total: imgs.length,
      missing,
      imgs: imgs.slice(0, 10), // Limit response
      status: 'success'
    });
  } catch (error) {
    res.json({ 
      error: 'Failed to check image alt tags',
      details: error.message 
    });
  }
});

// Robots.txt Check
app.get('/api/robots', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const origin = new URL(url).origin;
    const response = await safeGet(origin + '/robots.txt');
    
    res.json({
      robots: response.data,
      status: 'success'
    });
  } catch (error) {
    res.json({ 
      error: 'robots.txt not found',
      status: 'success'
    });
  }
});

// Sitemap Check
app.get('/api/sitemap', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const origin = new URL(url).origin;
    const response = await safeGet(origin + '/sitemap.xml');
    const xml = response.data;
    
    const urls = (xml.match(/<loc>(.*?)<\/loc>/g) || [])
      .map(s => s.replace(/<loc>|<\/loc>/g, ''))
      .slice(0, 20);

    res.json({
      total: urls.length,
      urls,
      status: 'success'
    });
  } catch (error) {
    res.json({ 
      error: 'sitemap not found',
      status: 'success'
    });
  }
});

// Page Speed Test
app.get('/api/pagespeed', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const startTime = Date.now();
    const response = await safeGet(url);
    const endTime = Date.now();
    
    const loadTime = endTime - startTime;
    const size = Buffer.byteLength(response.data, 'utf8');
    const $ = cheerio.load(response.data);
    
    const resources = $('img, script, link').length;

    res.json({
      load_ms: loadTime,
      size_bytes: size,
      resources,
      status: 'success'
    });
  } catch (error) {
    res.json({ 
      error: 'Failed to measure page speed',
      details: error.message 
    });
  }
});

// Links Report
app.get('/api/links-report', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const origin = new URL(url).origin;
    const response = await safeGet(url);
    const $ = cheerio.load(response.data);
    
    const internal = new Set();
    const external = new Set();
    
    $('a[href]').each((i, el) => {
      let href = $(el).attr('href');
      if (!href) return;
      
      if (href.startsWith('/')) {
        internal.add(origin + href);
      } else if (href.startsWith('http')) {
        if (href.startsWith(origin)) {
          internal.add(href);
        } else {
          external.add(href);
        }
      }
    });

    res.json({
      internal: Array.from(internal),
      external: Array.from(external),
      internal_count: internal.size,
      external_count: external.size,
      status: 'success'
    });
  } catch (error) {
    res.json({ 
      error: 'Failed to generate links report',
      details: error.message 
    });
  }
});

// Headings Analysis
app.get('/api/headings', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const response = await safeGet(url);
    const $ = cheerio.load(response.data);
    
    const headings = {};
    for (let i = 1; i <= 6; i++) {
      headings['h' + i] = $('h' + i).map((_, el) => 
        $(el).text().trim().substring(0, 100)
      ).get();
    }

    res.json({
      headings,
      status: 'success'
    });
  } catch (error) {
    res.json({ 
      error: 'Failed to analyze headings',
      details: error.message 
    });
  }
});

// Word Count & Readability
app.get('/api/wordcount', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const response = await safeGet(url);
    const $ = cheerio.load(response.data);
    
    // Clean content
    $('script, style, nav, footer').remove();
    
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    const sentences = text.split(/[.!?]+/).filter(s => s.trim());
    const words = text.split(/\s+/).filter(w => w.trim());
    
    let syllables = 0;
    for (const w of words.slice(0, 100)) {
      syllables += countSyllables(w);
    }
    
    const flesch = Math.round(
      206.835 - 
      1.015 * (words.length / Math.max(sentences.length, 1)) - 
      84.6 * (syllables / Math.max(words.length, 1))
    );

    res.json({
      words: words.length,
      sentences: sentences.length,
      syllables,
      flesch_reading_score: Math.max(0, Math.min(100, flesch)),
      read_time_min: Math.ceil(words.length / 200),
      status: 'success'
    });
  } catch (error) {
    res.json({ 
      error: 'Failed to calculate word count',
      details: error.message 
    });
  }
});

// Tech Stack Detection
app.get('/api/tech', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const response = await safeGet(url);
    const html = response.data;
    const $ = cheerio.load(html);
    
    const tech = {
      cms: null,
      frameworks: [],
      hosting: null
    };

    // Check CMS
    const metaGenerator = $('meta[name="generator"]').attr('content');
    if (metaGenerator) tech.cms = metaGenerator;
    
    if (html.includes('wp-content') || html.includes('wp-includes')) {
      tech.cms = 'WordPress';
    }
    if (html.includes('shopify.com')) {
      tech.cms = 'Shopify';
    }

    // Check Frameworks
    const scripts = $('script[src]').map((_, el) => $(el).attr('src')).get();
    
    if (html.includes('react') || scripts.some(s => s && s.includes('react'))) {
      tech.frameworks.push('React');
    }
    if (html.includes('jquery') || scripts.some(s => s && s.includes('jquery'))) {
      tech.frameworks.push('jQuery');
    }
    if (html.includes('vue') || scripts.some(s => s && s.includes('vue'))) {
      tech.frameworks.push('Vue.js');
    }

    // Server info
    if (response.headers && response.headers.server) {
      tech.hosting = response.headers.server;
    }

    res.json({
      tech,
      status: 'success'
    });
  } catch (error) {
    res.json({ 
      error: 'Failed to detect tech stack',
      details: error.message 
    });
  }
});

// Full Audit - All Tools Combined
app.get('/api/all', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const results = {};
    const endpoints = [
      'seo', 'meta', 'alts', 'headings', 'wordcount', 
      'keywords', 'links-report', 'broken-links', 
      'sitemap', 'robots', 'pagespeed', 'tech'
    ];

    // Get basic page data once
    const response = await safeGet(url);
    const $ = cheerio.load(response.data);

    // Run quick analyses
    results.seo = {
      title: $('title').text() || null,
      description: $('meta[name="description"]').attr('content') || null,
      h1: $('h1').first().text() || null
    };

    results.meta = {
      metas: Object.fromEntries(
        $('meta').map((i, el) => [
          $(el).attr('name') || $(el).attr('property') || `meta${i}`,
          $(el).attr('content') || null
        ]).get()
      )
    };

    results.alts = {
      total: $('img').length,
      missing: $('img:not([alt])').length
    };

    results.headings = {
      headings: Object.fromEntries(
        [1,2,3,4,5,6].map(i => [`h${i}`, $(`h${i}`).length])
      )
    };

    const text = $('body').text();
    const words = text.split(/\s+/).filter(w => w.trim());
    results.wordcount = {
      words: words.length,
      read_time_min: Math.ceil(words.length / 200)
    };

    results.pagespeed = {
      load_ms: 0, // Mock value for combined audit
      size_bytes: Buffer.byteLength(response.data, 'utf8'),
      resources: $('img, script, link').length
    };

    results.tech = {
      tech: {
        cms: $('meta[name="generator"]').attr('content') || 'Not detected',
        frameworks: []
      }
    };

    res.json(results);
  } catch (error) {
    res.json({ 
      error: 'Failed to complete full audit',
      details: error.message 
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'SEO Analyzer Pro API is running',
    timestamp: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SEO Analyzer Pro running on port ${PORT}`);
  console.log(`📊 Frontend: http://localhost:${PORT}`);
  console.log(`🔧 API Health: http://localhost:${PORT}/api/health`);
});