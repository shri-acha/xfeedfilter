(() => {
  // ── State ────────────────────────────────────────────────────────────────
  let keywords    = [];
  let filterMode  = 'semantic';
  let provider    = 'gemini';   // 'gemini' | 'openai'
  let openaiModel = 'gpt-4o-mini';

  const $ = id => document.getElementById(id);

  const el = {
    toggle:           $('enableToggle'),
    toggleStatus:     $('toggleStatus'),
    apiKey:           $('apiKey'),
    apiKeyLabel:      $('apiKeyLabel'),
    apiToggle:        $('apiToggle'),
    tagInput:         $('tagInput'),
    tagContainer:     $('tagContainer'),
    keywordsBox:      $('keywordsBox'),
    saveBtn:          $('saveBtn'),
    statusDot:        $('statusDot'),
    statusText:       $('statusText'),
    modeSemanticBtn:  $('modeSemanticBtn'),
    modeExactBtn:     $('modeExactBtn'),
    providerGeminiBtn:$('providerGeminiBtn'),
    providerOpenAIBtn:$('providerOpenAIBtn'),
    openaiModelRow:   $('openaiModelRow'),
    modelMiniBtn:     $('modelMiniBtn'),
    modelFullBtn:     $('modelFullBtn'),
    logoSub:          $('logoSub'),
  };

  // ── Load saved settings ───────────────────────────────────────────────────
  browser.storage.local.get(['apiKey','keywords','enabled','filterMode','provider','openaiModel']).then(data => {
    if (data.apiKey)      el.apiKey.value = data.apiKey;
    if (data.keywords)    { keywords = data.keywords; renderTags(); }
    if (data.filterMode)  { filterMode = data.filterMode; updateModeUI(); }
    if (data.provider)    { provider = data.provider; }
    if (data.openaiModel) { openaiModel = data.openaiModel; }

    updateProviderUI();
    updateModelUI();

    const enabled = data.enabled || false;
    el.toggle.checked = enabled;
    updateToggleUI(enabled);
    updateStatus();
  });

  // ── Provider UI ────────────────────────────────────────────────────────────
  [el.providerGeminiBtn, el.providerOpenAIBtn].forEach(btn => {
    btn.addEventListener('click', () => {
      provider = btn.dataset.provider;
      updateProviderUI();
      updateStatus();
    });
  });

  function updateProviderUI() {
    const isOpenAI = provider === 'openai';
    el.providerGeminiBtn.className = 'mode-btn' + (provider === 'gemini' ? ' active' : '');
    el.providerOpenAIBtn.className = 'mode-btn' + (isOpenAI              ? ' active' : '');
    el.openaiModelRow.style.display = isOpenAI ? '' : 'none';
    el.apiKeyLabel.textContent = isOpenAI ? 'OpenAI API Key' : 'Gemini API Key';
    el.apiKey.placeholder      = isOpenAI ? 'sk-...' : 'AIza...';
  }

  // ── OpenAI Model UI ────────────────────────────────────────────────────────
  [el.modelMiniBtn, el.modelFullBtn].forEach(btn => {
    btn.addEventListener('click', () => {
      openaiModel = btn.dataset.model;
      updateModelUI();
    });
  });

  function updateModelUI() {
    el.modelMiniBtn.className = 'mode-btn' + (openaiModel === 'gpt-4o-mini' ? ' active' : '');
    el.modelFullBtn.className = 'mode-btn' + (openaiModel === 'gpt-4o'      ? ' active' : '');
  }

  // ── Toggle ─────────────────────────────────────────────────────────────────
  el.toggle.addEventListener('change', () => {
    updateToggleUI(el.toggle.checked);
    updateStatus();
  });

  function updateToggleUI(on) {
    el.toggleStatus.textContent  = on ? 'ON' : 'OFF';
    el.toggleStatus.className    = 'toggle-status' + (on ? ' on' : '');
  }

  // ── API key show/hide ──────────────────────────────────────────────────────
  el.apiToggle.addEventListener('click', () => {
    const isPass = el.apiKey.type === 'password';
    el.apiKey.type = isPass ? 'text' : 'password';
    el.apiToggle.textContent = isPass ? '🙈' : '👁';
  });

  // ── Tags / Keywords ────────────────────────────────────────────────────────
  el.keywordsBox.addEventListener('click', () => el.tagInput.focus());

  el.tagInput.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ',') && el.tagInput.value.trim()) {
      e.preventDefault();
      addKeyword(el.tagInput.value.replace(',', '').trim());
      el.tagInput.value = '';
    }
    if (e.key === 'Backspace' && el.tagInput.value === '' && keywords.length > 0) {
      keywords.pop();
      renderTags();
    }
  });

  function addKeyword(word) {
    if (!word || keywords.includes(word.toLowerCase())) return;
    keywords.push(word.toLowerCase());
    renderTags();
  }

  function renderTags() {
    el.tagContainer.querySelectorAll('.tag').forEach(t => t.remove());
    keywords.forEach((kw, i) => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.innerHTML = `${escHtml(kw)} <span class="tag-remove" data-idx="${i}">×</span>`;
      el.tagContainer.insertBefore(tag, el.tagInput);
    });
    el.tagContainer.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        keywords.splice(parseInt(btn.dataset.idx), 1);
        renderTags();
      });
    });
  }

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Filter Mode ────────────────────────────────────────────────────────────
  [el.modeSemanticBtn, el.modeExactBtn].forEach(btn => {
    btn.addEventListener('click', () => {
      filterMode = btn.dataset.mode;
      updateModeUI();
      updateStatus();
    });
  });

  function updateModeUI() {
    el.modeSemanticBtn.className = 'mode-btn' + (filterMode === 'semantic' ? ' active' : '');
    el.modeExactBtn.className    = 'mode-btn' + (filterMode === 'exact'    ? ' active' : '');
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  function updateStatus() {
    const enabled = el.toggle.checked;
    const hasKey  = el.apiKey.value.trim().length > 0;
    const hasKW   = keywords.length > 0;

    if (!enabled) {
      setStatus('idle', 'Filtering is paused.');
    } else if (filterMode === 'semantic' && !hasKey) {
      setStatus('error', `Add a${provider === 'openai' ? 'n OpenAI' : ' Gemini'} API key to use semantic mode.`);
    } else if (!hasKW) {
      setStatus('error', 'Add at least one keyword to filter.');
    } else {
      const providerLabel = provider === 'openai' ? `OpenAI · ${openaiModel}` : 'Gemini';
      setStatus('active', `Active · ${keywords.length} keyword${keywords.length !== 1 ? 's' : ''} · ${filterMode} · ${providerLabel}`);
    }
  }

  function setStatus(type, msg) {
    el.statusText.textContent = msg;
    el.statusDot.className = 'status-dot' + (type === 'active' ? ' active' : type === 'error' ? ' error' : '');
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  el.saveBtn.addEventListener('click', async () => {
    const apiKey  = el.apiKey.value.trim();
    const enabled = el.toggle.checked;

    if (filterMode === 'semantic' && enabled && !apiKey) {
      setStatus('error', 'API key required for semantic mode.');
      el.apiKey.focus();
      return;
    }
    if (enabled && keywords.length === 0) {
      setStatus('error', 'Add at least one keyword first.');
      el.tagInput.focus();
      return;
    }

    const settings = { apiKey, keywords, enabled, filterMode, provider, openaiModel };
    await browser.storage.local.set(settings);

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab && (tab.url.includes('x.com') || tab.url.includes('twitter.com'))) {
      try { browser.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATE', settings }); }
      catch(e) { /* tab may not have content script loaded yet */ }
    }

    el.saveBtn.textContent = '✓ Saved!';
    setTimeout(() => { el.saveBtn.textContent = 'Save & Apply →'; }, 1500);
    updateStatus();
  });
})();
