/**
 * X Feed Filter — Content Script
 * Batches tweets and classifies them in a single Gemini API call
 * to stay within free-tier rate limits.
 */

(function () {
  'use strict';

  // ── Settings ───────────────────────────────────────────────────────────────
  let settings = {
    enabled:     false,
    apiKey:      '',
    kwWhite:     [],   // keep-keywords  → fed to AI as topics
    kwBlack:     [],   // block-keywords → always hide, no AI
    usersWl:     [],   // user whitelist → always show
    filterMode:  'semantic',
    provider:    'gemini',
    openaiModel: 'gpt-4o-mini',
  };

  // ── Cache & queue ──────────────────────────────────────────────────────────
  // text → true (keep) | false (hide)
  const cache = new Map();

  // Tweets waiting to be classified: { article, text }
  let queue = [];

  // Articles already submitted (prevent double-queuing)
  const submitted = new WeakSet();

  // Batch config
  const BATCH_SIZE     = 10;    // send when we have this many new tweets
  const BATCH_DELAY    = 5000;  // or after 5s, whichever comes first
  const RETRY_DELAY    = 62000; // 62s back-off after 429

  let batchTimer       = null;
  let rateLimitedUntil = 0;
  let lastCallAt        = 0;     // timestamp of last API call

  // ── Init ───────────────────────────────────────────────────────────────────
  browser.storage.local.get(['apiKey', 'kwWhite', 'kwBlack', 'usersWl', 'enabled', 'filterMode', 'provider', 'openaiModel']).then(data => {
    Object.assign(settings, data);
    if (settings.enabled && hasAnyList()) {
      observeFeed();
      scanExistingTweets();
    }
  });

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'SETTINGS_UPDATE') return;
    settings = msg.settings;
    cache.clear();
    queue = [];
    clearTimeout(batchTimer);
    batchTimer = null;

    if (settings.enabled && hasAnyList()) {
      observeFeed();
      scanExistingTweets();
    } else {
      showAllTweets();
      stopObserving();
    }
  });

  function hasAnyList() {
    return (settings.kwWhite || []).length > 0 ||
           (settings.kwBlack || []).length > 0 ||
           (settings.usersWl || []).length > 0;
  }

  // ── Observer ───────────────────────────────────────────────────────────────
  let observer = null;

  function observeFeed() {
    if (observer) return;
    observer = new MutationObserver(mutations => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (isTweetArticle(node)) enqueueTweet(node);
          node.querySelectorAll &&
            node.querySelectorAll('article[data-testid="tweet"]').forEach(enqueueTweet);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserving() {
    if (observer) { observer.disconnect(); observer = null; }
  }

  function scanExistingTweets() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach(enqueueTweet);
  }

  function showAllTweets() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach(el => {
      el.setAttribute('data-xfilter', 'kept');
    });
  }

  // ── Enqueue / priority chain ───────────────────────────────────────────────
  function enqueueTweet(article) {
    if (submitted.has(article)) return;
    if (!settings.enabled) return;

    const text   = getTweetText(article);
    const author = getTweetAuthor(article); // lowercase handle, no @

    submitted.add(article);

    // 1. User whitelist — always show, bypass everything
    if ((settings.usersWl || []).includes(author)) {
      applyFilter(article, true);
      return;
    }

    // 2. Keyword blacklist — always hide if any blocked word found in text
    if ((settings.kwBlack || []).length > 0) {
      const lower = text.toLowerCase();
      if ((settings.kwBlack).some(kw => lower.includes(kw))) {
        applyFilter(article, false);
        return;
      }
    }

    // 4. No keep-keywords set → show everything that passed above rules
    if ((settings.kwWhite || []).length === 0) {
      applyFilter(article, true);
      return;
    }

    if (!text) { applyFilter(article, true); return; }

    // 5. Cache hit
    if (cache.has(text)) {
      applyFilter(article, cache.get(text));
      return;
    }

    // 5. Exact mode
    if (settings.filterMode === 'exact') {
      const keep = exactMatch(text, settings.kwWhite);
      cache.set(text, keep);
      applyFilter(article, keep);
      return;
    }

    // 6. AI semantic — queue it
    article.setAttribute('data-xfilter', 'pending');
    queue.push({ article, text });

    if (queue.length >= BATCH_SIZE) {
      flushQueue();
    } else if (!batchTimer) {
      batchTimer = setTimeout(flushQueue, BATCH_DELAY);
    }
  }

  // ── Flush batch ────────────────────────────────────────────────────────────
  async function flushQueue() {
    clearTimeout(batchTimer);
    batchTimer = null;

    if (queue.length === 0) return;

    // Respect rate-limit back-off AND minimum inter-call gap (stay under 15 RPM)
    const MIN_CALL_GAP = 5000; // 5s between calls = max 12 RPM
    const now = Date.now();
    if (now < rateLimitedUntil) {
      const wait = rateLimitedUntil - now;
      console.log(`[XFilter] Rate-limited. Retrying in ${Math.ceil(wait / 1000)}s…`);
      batchTimer = setTimeout(flushQueue, wait);
      return;
    }
    const sinceLastCall = now - lastCallAt;
    if (lastCallAt > 0 && sinceLastCall < MIN_CALL_GAP) {
      const wait = MIN_CALL_GAP - sinceLastCall;
      console.log(`[XFilter] Throttling — next call in ${Math.ceil(wait / 1000)}s`);
      batchTimer = setTimeout(flushQueue, wait);
      return;
    }

    // Grab the current batch and reset the queue
    const batch = queue.splice(0, BATCH_SIZE);

    // Deduplicate by text — group articles that share the same tweet text
    const unique = [];
    const textToArticles = new Map();
    for (const item of batch) {
      if (textToArticles.has(item.text)) {
        textToArticles.get(item.text).push(item.article);
      } else {
        textToArticles.set(item.text, [item.article]);
        unique.push(item.text);
      }
    }

    console.log(`[XFilter] Sending batch of ${unique.length} tweets to ${settings.provider}…`);

    let results;
    try {
      results = settings.provider === 'openai'
        ? await classifyBatchOpenAI(unique, settings.kwWhite, settings.apiKey, settings.openaiModel)
        : await classifyBatchGemini(unique, settings.kwWhite, settings.apiKey);
    } catch (err) {
      // On rate limit, classifyBatch already re-queued and set the timer — just return
      if (err.message === 'Rate limited') return;
      console.warn('[XFilter] Batch classify failed:', err);
      // Fail-open: show all tweets in this batch
      for (const [, articles] of textToArticles) {
        articles.forEach(a => applyFilter(a, true));
      }
      return;
    }

    // Apply results
    lastCallAt = Date.now();
    unique.forEach((text, i) => {
      const keep = results[i] !== false; // default keep on parse error
      cache.set(text, keep);
      textToArticles.get(text).forEach(a => applyFilter(a, keep));
    });

    // If there are more items left in the queue, schedule another flush (respecting gap)
    if (queue.length > 0 && !batchTimer) {
      batchTimer = setTimeout(flushQueue, MIN_CALL_GAP);
    }
  }

  // ── Gemini batch classifier ────────────────────────────────────────────────
  const GEMINI_URL =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent';

  async function classifyBatchGemini(texts, keywords, apiKey) {
    const numbered = texts
      .map((t, i) => `${i + 1}. "${t.slice(0, 180).replace(/"/g, "'")}"`)
      .join('\n');

    const prompt =
`You are a tweet relevance classifier.

Topics/Keywords: ${keywords.join(', ')}

Below are ${texts.length} tweets, each numbered. Decide if each tweet is relevant to ANY of the topics above (consider synonyms and semantic meaning, not just exact words).

${numbered}

Reply with ONLY a JSON array of booleans, one per tweet, in the same order.
Example for 3 tweets: [true, false, true]
No explanation. No markdown. Just the raw JSON array.`;

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 256 },
      }),
    });

    if (!res.ok) {
      const body = await res.text();

      if (res.status === 429) {
        let retryAfter = RETRY_DELAY;
        try {
          const json = JSON.parse(body);
          const retryInfo = json?.error?.details?.find(d => d.retryDelay);
          if (retryInfo?.retryDelay) {
            retryAfter = (parseInt(retryInfo.retryDelay) + 2) * 1000;
          }
        } catch (_) { /* ignore */ }

        rateLimitedUntil = Date.now() + retryAfter;
        console.warn(`[XFilter] 429 Rate limited — will retry in ${retryAfter / 1000}s`);

        batchTimer = setTimeout(() => {
          document.querySelectorAll('article[data-testid="tweet"][data-xfilter="pending"]')
            .forEach(a => {
              const text = getTweetText(a);
              if (text && !cache.has(text)) queue.push({ article: a, text });
            });
          flushQueue();
        }, retryAfter);

        throw new Error('Rate limited');
      }

      console.warn('[XFilter] Gemini API error:', res.status, body);
      throw new Error(`API error ${res.status}`);
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    return parseBoolArray(raw, texts.length);
  }

  // ── OpenAI batch classifier ────────────────────────────────────────────────
  const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

  async function classifyBatchOpenAI(texts, keywords, apiKey, model = 'gpt-4o-mini') {
    const numbered = texts
      .map((t, i) => `${i + 1}. "${t.slice(0, 180).replace(/"/g, "'")}"`)
      .join('\n');

    const systemPrompt =
`You are a tweet relevance classifier. Given a list of topics/keywords and numbered tweets, return ONLY a JSON array of booleans indicating whether each tweet is relevant to ANY of the topics. Consider synonyms and semantic meaning. No explanation, no markdown — raw JSON array only.`;

    const userPrompt =
`Topics/Keywords: ${keywords.join(', ')}

Tweets:
${numbered}

Reply with a JSON boolean array, one entry per tweet. Example for 3 tweets: [true, false, true]`;

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();

      if (res.status === 429) {
        // OpenAI includes Retry-After header
        const retryHeader = res.headers.get('Retry-After');
        const retryAfter  = retryHeader ? (parseInt(retryHeader) + 2) * 1000 : RETRY_DELAY;
        rateLimitedUntil  = Date.now() + retryAfter;
        console.warn(`[XFilter] OpenAI 429 — retrying in ${retryAfter / 1000}s`);

        batchTimer = setTimeout(() => {
          document.querySelectorAll('article[data-testid="tweet"][data-xfilter="pending"]')
            .forEach(a => {
              const text = getTweetText(a);
              if (text && !cache.has(text)) queue.push({ article: a, text });
            });
          flushQueue();
        }, retryAfter);

        throw new Error('Rate limited');
      }

      console.warn('[XFilter] OpenAI API error:', res.status, body);
      throw new Error(`OpenAI API error ${res.status}`);
    }

    const data = await res.json();
    const raw  = data?.choices?.[0]?.message?.content?.trim() ?? '';
    return parseBoolArray(raw, texts.length);
  }

  // ── Shared response parser ─────────────────────────────────────────────────
  function parseBoolArray(raw, expectedLength) {
    try {
      const clean  = raw.replace(/```json|```/gi, '').trim();
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        console.log(`[XFilter] Result: ${parsed.filter(Boolean).length}/${parsed.length} kept`);
        return parsed.map(Boolean);
      }
    } catch (_) { /* fall through */ }

    console.warn('[XFilter] Could not parse JSON array, falling back to line parse. Raw:', raw);
    return raw.split('\n').map(line => !/false/i.test(line));
  }

  // ── Inject persistent CSS (survives React re-renders) ─────────────────────
  // X's React will overwrite inline styles, so we use a <style> tag instead.
  // We mark the article with data-xfilter="hidden" and hide via CSS.
  const styleEl = document.createElement('style');
  styleEl.id = 'xfilter-styles';
  styleEl.textContent = `
    article[data-testid="tweet"][data-xfilter="hidden"] {
      display: none !important;
    }
  `;
  document.head.appendChild(styleEl);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function isTweetArticle(node) {
    return node.tagName === 'ARTICLE' && node.dataset?.testid === 'tweet';
  }

  function getTweetText(article) {
    const el = article.querySelector('[data-testid="tweetText"]');
    return el ? el.innerText.trim() : '';
  }

  function getTweetAuthor(article) {
    // The @handle lives in a link with href="/username"
    const link = article.querySelector('a[href^="/"][role="link"] span');
    if (link) {
      const txt = link.innerText.trim().replace(/^@/, '');
      if (txt && !txt.includes(' ')) return txt.toLowerCase();
    }
    // Fallback: find the User-Name testid
    const nameEl = article.querySelector('[data-testid="User-Name"] a');
    if (nameEl) {
      const href = nameEl.getAttribute('href') || '';
      const handle = href.replace('/', '').toLowerCase();
      if (handle && !handle.includes('/')) return handle;
    }
    return '';
  }

  function applyFilter(article, shouldKeep) {
    if (!article) return;
    // Set attribute on the article — CSS rule above does the hiding.
    // This survives React re-renders because React won't touch data-xfilter.
    article.setAttribute('data-xfilter', shouldKeep ? 'kept' : 'hidden');
    console.log(`[XFilter] ${shouldKeep ? '✅ kept' : '❌ hidden'}: "${getTweetText(article).slice(0, 60)}"`);
  }

  function exactMatch(text, kwWhite) {
    const lower = text.toLowerCase();
    return kwWhite.some(kw => lower.includes(kw));
  }

})();
