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

// Safe HTTP request function (Updated to be more robust)
function safeGet(url) {
  return axios.get(url, {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    validateStatus: (status) => {
      // Allow 2xx, 3xx (redirects), but treat 4xx, 5xx as errors
      return status >= 200 && status < 400; 
    },
    maxRedirects: 5 // Follow up to 5 redirects
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

// Broken Links Check (IMPROVED: Checks A, IMG, LINK tags and more links)
app.get('/api/broken-links', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const response = await safeGet(url);
    const $ = cheerio.load(response.data);
    const origin = new URL(url).origin;
    
    let links = [];

    // 1. Hyperlinks (a[href])
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('http') && !href.startsWith(origin)) {
        links.push(href);
      }
    });

    // 2. Image Sources (img[src])
    $('img[src]').each((i, el) => {
        let src = $(el).attr('src');
        if (src) {
            // Resolve relative URLs to absolute
            if (src.startsWith('//')) src = 'http:' + src;
            if (!src.startsWith('http')) {
              src = new URL(src, url).href;
            }
            if (!src.startsWith(origin)) { // Only check external images
              links.push(src);
            }
        }
    });

    // 3. Stylesheets and Resources (link[href] and script[src])
    $('link[href], script[src]').each((i, el) => {
        let href = $(el).attr('href') || $(el).attr('src');
        if (href) {
            if (href.startsWith('//')) href = 'http:' + href;
            if (!href.startsWith('http')) {
              href = new URL(href, url).href;
            }
            // Include internal resource links as well, since they can be broken
            links.push(href);
        }
    });


    // Remove duplicates and check first 20 links for performance
    links = [...new Set(links)].slice(0, 20);
    let broken = [];

    // Check status for each link
    await Promise.all(links.map(async (link) => {
      try {
        await axios.head(link, { timeout: 8000 }); // Use HEAD for faster check
      } catch (e) {
        // Only report 4xx or 5xx errors (e.g., 404, 500)
        if (e.response && (e.response.status >= 400 || e.response.status === 0)) {
            broken.push(`${link} (Status: ${e.response.status || 'Timeout'})`);
        } else if (e.code === 'ECONNABORTED') {
             broken.push(`${link} (Status: Timeout)`);
        }
      }
    }));

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
      status: 'error',
      details: 'Could not fetch robots.txt file (404/Network Error)'
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
      status: 'error',
      details: 'Could not fetch sitemap.xml file (404/Network Error)'
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
      
      // Resolve relative links
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
      internal: Array.from(internal).slice(0, 50),
      external: Array.from(external).slice(0, 50),
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
    // Only calculate for first 500 words for performance
    for (const w of words.slice(0, 500)) { 
      syllables += countSyllables(w);
    }
    
    // Flesch Reading Ease Formula
    const ASL = words.length / Math.max(sentences.length, 1); // Average Sentence Length
    const ASW = syllables / Math.max(words.length, 1);       // Average Syllables per Word

    const flesch = Math.round(
      206.835 - 
      1.015 * ASL - 
      84.6 * ASW
    );

    res.json({
      words: words.length,
      sentences: sentences.length,
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
    } else if (html.includes('shopify.com') || $('link[href*="shopify.com"]').length) {
      tech.cms = 'Shopify';
    } else if ($('script[src*="wix.com"]').length) {
       tech.cms = 'Wix';
    }


    // Check Frameworks
    const scripts = $('script[src]').map((_, el) => $(el).attr('src')).get();
    const frameworkSet = new Set();
    
    if (html.includes('react') || scripts.some(s => s && s.includes('react'))) {
      frameworkSet.add('React');
    }
    if (html.includes('jquery') || scripts.some(s => s && s.includes('jquery'))) {
      frameworkSet.add('jQuery');
    }
    if (html.includes('vue') || scripts.some(s => s && s.includes('vue'))) {
      frameworkSet.add('Vue.js');
    }

    tech.frameworks = Array.from(frameworkSet);

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

// Full Audit - All Tools Combined (FIXED: Now runs all individual checks)
app.get('/api/all', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.json({ error: 'URL missing' });

    const apiCalls = [
      axios.get(`http://localhost:${PORT}/api/seo?url=${encodeURIComponent(url)}`),
      axios.get(`http://localhost:${PORT}/api/meta?url=${encodeURIComponent(url)}`),
      axios.get(`http://localhost:${PORT}/api/alts?url=${encodeURIComponent(url)}`),
      axios.get(`http://localhost:${PORT}/api/headings?url=${encodeURIComponent(url)}`),
      axios.get(`http://localhost:${PORT}/api/wordcount?url=${encodeURIComponent(url)}`),
      axios.get(`http://localhost:${PORT}/api/keywords?url=${encodeURIComponent(url)}`),
      axios.get(`http://localhost:${PORT}/api/links-report?url=${encodeURIComponent(url)}`),
      axios.get(`http://localhost:${PORT}/api/broken-links?url=${encodeURIComponent(url)}`),
      axios.get(`http://localhost:${PORT}/api/sitemap?url=${encodeURIComponent(url)}`),
      axios.get(`http://localhost:${PORT}/api/robots?url=${encodeURIComponent(url)}`),
      axios.get(`http://localhost:${PORT}/api/pagespeed?url=${encodeURIComponent(url)}`),
      axios.get(`http://localhost:${PORT}/api/tech?url=${encodeURIComponent(url)}`)
    ];

    const resultsArray = await Promise.allSettled(apiCalls);

    const results = {
        seo: (resultsArray[0].status === 'fulfilled') ? resultsArray[0].value.data : { error: 'SEO Check Failed' },
        meta: (resultsArray[1].status === 'fulfilled') ? resultsArray[1].value.data : { error: 'Meta Check Failed' },
        alts: (resultsArray[2].status === 'fulfilled') ? resultsArray[2].value.data : { error: 'Alts Check Failed' },
        headings: (resultsArray[3].status === 'fulfilled') ? resultsArray[3].value.data : { error: 'Headings Check Failed' },
        wordcount: (resultsArray[4].status === 'fulfilled') ? resultsArray[4].value.data : { error: 'Word Count Failed' },
        keywords: (resultsArray[5].status === 'fulfilled') ? resultsArray[5].value.data : { error: 'Keywords Failed' },
        'links-report': (resultsArray[6].status === 'fulfilled') ? resultsArray[6].value.data : { error: 'Links Report Failed' },
        'broken-links': (resultsArray[7].status === 'fulfilled') ? resultsArray[7].value.data : { error: 'Broken Links Failed' },
        sitemap: (resultsArray[8].status === 'fulfilled') ? resultsArray[8].value.data : { error: 'Sitemap Failed' },
        robots: (resultsArray[9].status === 'fulfilled') ? resultsArray[9].value.data : { error: 'Robots Failed' },
        pagespeed: (resultsArray[10].status === 'fulfilled') ? resultsArray[10].value.data : { error: 'Page Speed Failed' },
        tech: (resultsArray[11].status === 'fulfilled') ? resultsArray[11].value.data : { error: 'Tech Stack Failed' }
    };
    
    // Clean up status field from nested objects if present
    Object.keys(results).forEach(key => {
        if (results[key] && results[key].status) delete results[key].status;
    });

    res.json(results);
  } catch (error) {
    res.json({ 
      error: 'Failed to coordinate full audit',
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