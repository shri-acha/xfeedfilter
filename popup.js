(() => {
  let kwWhite   = [];
  let kwBlack   = [];
  let filterMode  = 'semantic';
  let provider    = 'gemini';
  let openaiModel = 'gpt-4o-mini';

  const $ = id => document.getElementById(id);

  const el = {
    toggle:            $('enableToggle'),
    toggleStatus:      $('toggleStatus'),
    apiKey:            $('apiKey'),
    apiKeyLabel:       $('apiKeyLabel'),
    apiToggle:         $('apiToggle'),
    saveBtn:           $('saveBtn'),
    statusDot:         $('statusDot'),
    statusText:        $('statusText'),
    modeSemanticBtn:   $('modeSemanticBtn'),
    modeExactBtn:      $('modeExactBtn'),
    providerGeminiBtn: $('providerGeminiBtn'),
    providerOpenAIBtn: $('providerOpenAIBtn'),
    openaiModelRow:    $('openaiModelRow'),
    modelMiniBtn:      $('modelMiniBtn'),
    modelFullBtn:      $('modelFullBtn'),
    logoSub:           $('logoSub'),
    tabKwWhite:        $('tabKwWhite'),
    tabKwBlack:        $('tabKwBlack'),
    panelKwWhite:      $('panelKwWhite'),
    panelKwBlack:      $('panelKwBlack'),
    kwWhiteBox:        $('kwWhiteBox'),
    kwWhiteContainer:  $('kwWhiteContainer'),
    kwWhiteInput:      $('kwWhiteInput'),
    kwBlackBox:        $('kwBlackBox'),
    kwBlackContainer:  $('kwBlackContainer'),
    kwBlackInput:      $('kwBlackInput'),
  };

  // ── Load ───────────────────────────────────────────────────────────────────
  browser.storage.local.get([
    'apiKey','enabled','filterMode','provider','openaiModel',
    'kwWhite','kwBlack'
  ]).then(data => {
    if (data.apiKey)      el.apiKey.value = data.apiKey;
    if (data.filterMode)  { filterMode  = data.filterMode;  updateModeUI(); }
    if (data.provider)    { provider    = data.provider; }
    if (data.openaiModel) { openaiModel = data.openaiModel; }
    if (data.kwWhite)     kwWhite = data.kwWhite;
    if (data.kwBlack)     kwBlack = data.kwBlack;

    renderAllTags();
    updateProviderUI();
    updateModelUI();
    el.toggle.checked = data.enabled || false;
    updateToggleUI(el.toggle.checked);
    updateStatus();
  });

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const tabDefs = [
    { btn: el.tabKwWhite, panel: el.panelKwWhite, key: 'kwWhite', cls: 'active-white' },
    { btn: el.tabKwBlack, panel: el.panelKwBlack, key: 'kwBlack', cls: 'active-black' },
  ];

  tabDefs.forEach(({ btn, key, cls }) => {
    btn.addEventListener('click', () => {
      tabDefs.forEach(t => {
        t.btn.className   = 'tab-btn' + (t.key === key ? ` ${t.cls}` : '');
        t.panel.className = 'tab-panel' + (t.key === key ? ' visible' : '');
      });
    });
  });

  el.kwWhiteBox.addEventListener('click', () => el.kwWhiteInput.focus());
  el.kwBlackBox.addEventListener('click', () => el.kwBlackInput.focus());

  // ── Tag inputs ─────────────────────────────────────────────────────────────
  setupTagInput(el.kwWhiteInput, 'kwWhite', 'kw-white');
  setupTagInput(el.kwBlackInput, 'kwBlack', 'kw-black');

  function setupTagInput(input, listKey, tagCls, normalize) {
    input.addEventListener('keydown', e => {
      const lists = { kwWhite, kwBlack };
      const list  = lists[listKey];
      const raw   = input.value.replace(',', '').trim();
      if ((e.key === 'Enter' || e.key === ',') && raw) {
        e.preventDefault();
        const val = normalize ? normalize(raw) : raw.toLowerCase();
        if (val && !list.includes(val)) { list.push(val); renderTags(listKey, tagCls); }
        input.value = '';
      }
      if (e.key === 'Backspace' && input.value === '' && list.length > 0) {
        list.pop(); renderTags(listKey, tagCls);
      }
    });
  }

  function renderAllTags() {
    renderTags('kwWhite', 'kw-white');
    renderTags('kwBlack', 'kw-black');
  }

  function renderTags(listKey, tagCls) {
    const containers = { kwWhite: el.kwWhiteContainer, kwBlack: el.kwBlackContainer };
    const inputs     = { kwWhite: el.kwWhiteInput,     kwBlack: el.kwBlackInput };
    const lists      = { kwWhite, kwBlack };
    const container  = containers[listKey];
    const input      = inputs[listKey];
    const list       = lists[listKey];

    container.querySelectorAll('.tag').forEach(t => t.remove());
    list.forEach((val, i) => {
      const tag    = document.createElement('span');
      tag.className = `tag ${tagCls}`;
      const prefix = '';
      tag.innerHTML = `${escHtml(prefix + val)} <span class="tag-remove" data-list="${listKey}" data-idx="${i}">×</span>`;
      container.insertBefore(tag, input);
    });
    container.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        lists[btn.dataset.list].splice(parseInt(btn.dataset.idx), 1);
        renderTags(listKey, tagCls);
      });
    });
    updateStatus();
  }

  function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── Provider ───────────────────────────────────────────────────────────────
  [el.providerGeminiBtn, el.providerOpenAIBtn].forEach(btn => {
    btn.addEventListener('click', () => { provider = btn.dataset.provider; updateProviderUI(); updateStatus(); });
  });

  function updateProviderUI() {
    const isOpenAI = provider === 'openai';
    el.providerGeminiBtn.className = 'mode-btn' + (provider === 'gemini' ? ' active' : '');
    el.providerOpenAIBtn.className = 'mode-btn' + (isOpenAI              ? ' active' : '');
    el.openaiModelRow.style.display = isOpenAI ? '' : 'none';
    el.apiKeyLabel.textContent = isOpenAI ? 'OpenAI API Key' : 'Gemini API Key';
    el.apiKey.placeholder      = isOpenAI ? 'sk-...' : 'AIza...';
    el.logoSub.textContent     = isOpenAI ? 'Powered by OpenAI' : 'Powered by Gemini AI';
  }

  // ── Model ──────────────────────────────────────────────────────────────────
  [el.modelMiniBtn, el.modelFullBtn].forEach(btn => {
    btn.addEventListener('click', () => { openaiModel = btn.dataset.model; updateModelUI(); });
  });
  function updateModelUI() {
    el.modelMiniBtn.className = 'mode-btn' + (openaiModel === 'gpt-4o-mini' ? ' active' : '');
    el.modelFullBtn.className = 'mode-btn' + (openaiModel === 'gpt-4o'      ? ' active' : '');
  }

  // ── Toggle ─────────────────────────────────────────────────────────────────
  el.toggle.addEventListener('change', () => { updateToggleUI(el.toggle.checked); updateStatus(); });
  function updateToggleUI(on) {
    el.toggleStatus.textContent = on ? 'ON' : 'OFF';
    el.toggleStatus.className   = 'toggle-status' + (on ? ' on' : '');
  }

  // ── API key show/hide ──────────────────────────────────────────────────────
  el.apiToggle.addEventListener('click', () => {
    const isPass = el.apiKey.type === 'password';
    el.apiKey.type = isPass ? 'text' : 'password';
    el.apiToggle.textContent = isPass ? 'hide' : 'show';
  });

  // ── Filter Mode ────────────────────────────────────────────────────────────
  [el.modeSemanticBtn, el.modeExactBtn].forEach(btn => {
    btn.addEventListener('click', () => { filterMode = btn.dataset.mode; updateModeUI(); updateStatus(); });
  });
  function updateModeUI() {
    el.modeSemanticBtn.className = 'mode-btn' + (filterMode === 'semantic' ? ' active' : '');
    el.modeExactBtn.className    = 'mode-btn' + (filterMode === 'exact'    ? ' active' : '');
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  function updateStatus() {
    const enabled = el.toggle.checked;
    const hasKey  = el.apiKey.value.trim().length > 0;
    const hasAny  = kwWhite.length > 0 || kwBlack.length > 0;

    if (!enabled) {
      setStatus('idle', 'Filtering is paused.');
    } else if (filterMode === 'semantic' && !hasKey && kwWhite.length > 0) {
      setStatus('error', `Add a${provider === 'openai' ? 'n OpenAI' : ' Gemini'} API key for semantic mode.`);
    } else if (!hasAny) {
      setStatus('error', 'Add at least one keyword or whitelisted user.');
    } else {
      const parts = [];
      if (kwWhite.length) parts.push(`${kwWhite.length} keep`);
      if (kwBlack.length) parts.push(`${kwBlack.length} block`);
      setStatus('active', `Active · ${parts.join(' · ')}`);
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

    if (filterMode === 'semantic' && enabled && !apiKey && kwWhite.length > 0) {
      setStatus('error', 'API key required for semantic mode.');
      el.apiKey.focus();
      return;
    }

    const settings = { apiKey, enabled, filterMode, provider, openaiModel, kwWhite, kwBlack };
    await browser.storage.local.set(settings);

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab && (tab.url.includes('x.com') || tab.url.includes('twitter.com'))) {
      try { browser.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATE', settings }); } catch(e) {}
    }

    el.saveBtn.textContent = 'Saved!';
    setTimeout(() => { el.saveBtn.textContent = 'Save & Apply'; }, 1500);
    updateStatus();
  });
})();
