// ==UserScript==
// @name         ChatGPT 对话目录（用户问题版）
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  在 ChatGPT 页面右侧生成对话目录，按用户问题快速跳转
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'gpt-toc-panel-v1';
  const TOGGLE_ID = 'gpt-toc-toggle-v1';
  const STYLE_ID = 'gpt-toc-style-v1';
  const ITEM_CLASS = 'gpt-toc-item-v1';
  const ITEM_ACTIVE_CLASS = 'gpt-toc-item-active-v1';
  const TARGET_ATTR = 'data-gpt-toc-target-id';
  const HIGHLIGHT_CLASS = 'gpt-toc-highlight-v1';

  let mutationObserver = null;
  let intersectionObserver = null;
  let rebuildTimer = null;
  let lastUrl = location.href;
  let currentEntries = [];

  function log(...args) {
    console.log('[GPT-TOC]', ...args);
  }

  function debounceRebuild(delay = 500) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => buildTOC(), delay);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: 72px;
        right: 16px;
        width: 300px;
        max-height: 78vh;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(20, 20, 20, 0.92);
        color: #fff;
        backdrop-filter: blur(10px);
        box-shadow: 0 10px 30px rgba(0,0,0,0.25);
        font-family: Arial, sans-serif;
      }

      #${PANEL_ID}.light {
        background: rgba(255,255,255,0.95);
        color: #111;
        border: 1px solid rgba(0,0,0,0.08);
      }

      #${PANEL_ID} .gpt-toc-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        font-size: 14px;
        font-weight: 700;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }

      #${PANEL_ID}.light .gpt-toc-header {
        border-bottom: 1px solid rgba(0,0,0,0.08);
      }

      #${PANEL_ID} .gpt-toc-actions {
        display: flex;
        gap: 6px;
      }

      #${PANEL_ID} button {
        border: none;
        border-radius: 8px;
        padding: 5px 8px;
        cursor: pointer;
        background: rgba(255,255,255,0.10);
        color: inherit;
        font-size: 12px;
      }

      #${PANEL_ID}.light button {
        background: rgba(0,0,0,0.06);
      }

      #${PANEL_ID} .gpt-toc-status {
        padding: 8px 12px 0 12px;
        font-size: 12px;
        opacity: 0.8;
      }

      #${PANEL_ID} .gpt-toc-list {
        overflow-y: auto;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .${ITEM_CLASS} {
        background: rgba(255,255,255,0.06);
        border: 1px solid transparent;
        border-radius: 10px;
        padding: 8px 10px;
        cursor: pointer;
        font-size: 13px;
        line-height: 1.35;
        word-break: break-word;
        transition: 0.15s ease;
      }

      #${PANEL_ID}.light .${ITEM_CLASS} {
        background: rgba(0,0,0,0.04);
      }

      .${ITEM_CLASS}:hover {
        border-color: rgba(80,160,255,0.75);
      }

      .${ITEM_ACTIVE_CLASS} {
        background: rgba(80,160,255,0.20) !important;
        border-color: rgba(80,160,255,0.95) !important;
      }

      .gpt-toc-item-label {
        font-size: 11px;
        opacity: 0.7;
        margin-bottom: 4px;
      }

      .${HIGHLIGHT_CLASS} {
        outline: 2px solid rgba(80,160,255,0.9);
        outline-offset: 4px;
        border-radius: 12px;
      }

      #${TOGGLE_ID} {
        position: fixed;
        top: 72px;
        right: 16px;
        z-index: 1000000;
        border: none;
        border-radius: 12px;
        padding: 10px 12px;
        background: rgba(20,20,20,0.92);
        color: #fff;
        box-shadow: 0 10px 30px rgba(0,0,0,0.25);
        cursor: pointer;
        display: none;
      }

      #${TOGGLE_ID}.light {
        background: rgba(255,255,255,0.95);
        color: #111;
        border: 1px solid rgba(0,0,0,0.08);
      }
    `;
    document.head.appendChild(style);
  }

  function isLightMode() {
    const bg = getComputedStyle(document.body).backgroundColor;
    return bg === 'rgb(255, 255, 255)';
  }

  function applyTheme() {
    const light = isLightMode();
    const panel = document.getElementById(PANEL_ID);
    const toggle = document.getElementById(TOGGLE_ID);
    if (panel) panel.classList.toggle('light', light);
    if (toggle) toggle.classList.toggle('light', light);
  }

  function ensureUI() {
    if (!document.getElementById(PANEL_ID)) {
      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.innerHTML = `
        <div class="gpt-toc-header">
          <span>对话目录</span>
          <div class="gpt-toc-actions">
            <button id="gpt-toc-refresh-btn" type="button">刷新</button>
            <button id="gpt-toc-hide-btn" type="button">隐藏</button>
          </div>
        </div>
        <div class="gpt-toc-status" id="gpt-toc-status">初始化中…</div>
        <div class="gpt-toc-list" id="gpt-toc-list"></div>
      `;
      document.body.appendChild(panel);

      panel.querySelector('#gpt-toc-refresh-btn').addEventListener('click', () => buildTOC());
      panel.querySelector('#gpt-toc-hide-btn').addEventListener('click', () => {
        panel.style.display = 'none';
        const toggle = document.getElementById(TOGGLE_ID);
        if (toggle) toggle.style.display = 'block';
      });
    }

    if (!document.getElementById(TOGGLE_ID)) {
      const toggle = document.createElement('button');
      toggle.id = TOGGLE_ID;
      toggle.textContent = '目录';
      toggle.addEventListener('click', () => {
        const panel = document.getElementById(PANEL_ID);
        if (panel) panel.style.display = 'flex';
        toggle.style.display = 'none';
      });
      document.body.appendChild(toggle);
    }

    applyTheme();
  }

  function setStatus(text) {
    const el = document.getElementById('gpt-toc-status');
    if (el) el.textContent = text;
  }

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function previewText(text, maxLen = 56) {
    const t = normalizeText(text);
    if (!t) return '（空内容）';
    return t.length > maxLen ? t.slice(0, maxLen) + '…' : t;
  }

  function getMain() {
    return document.querySelector('main');
  }

  function getMessageCandidates() {
    const main = getMain();
    if (!main) return [];

    const articles = Array.from(main.querySelectorAll('article'));
    if (articles.length > 0) return articles;

    const selectors = [
      '[data-testid^="conversation-turn"]',
      '[data-message-author-role]',
      '[data-testid*="conversation"]'
    ];

    for (const sel of selectors) {
      const nodes = Array.from(main.querySelectorAll(sel));
      if (nodes.length > 0) return nodes;
    }

    const blocks = Array.from(main.querySelectorAll('div')).filter(el => {
      const text = normalizeText(el.innerText);
      const rect = el.getBoundingClientRect();
      if (!text) return false;
      if (rect.height < 60 || rect.width < 240) return false;
      if (text.length < 12) return false;
      if (el.closest(`#${PANEL_ID}`)) return false;
      return true;
    });

    return blocks.filter(el => !blocks.some(other => other !== el && other.contains(el)));
  }

  function inferRole(el) {
    const roleAttr = el.getAttribute('data-message-author-role');
    if (roleAttr) return roleAttr;

    const text = normalizeText(el.innerText).toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();

    if (aria.includes('user') || text.startsWith('you said')) return 'user';
    if (aria.includes('assistant') || aria.includes('chatgpt')) return 'assistant';

    const inner = el.innerHTML.toLowerCase();
    if (inner.includes('data-message-author-role="user"')) return 'user';
    if (inner.includes('data-message-author-role="assistant"')) return 'assistant';

    return 'unknown';
  }

  function getUserMessageEntries() {
    const candidates = getMessageCandidates();
    const entries = [];
    let turn = 0;

    candidates.forEach((el, idx) => {
      const role = inferRole(el);
      const text = normalizeText(el.innerText);

      if (!text) return;

      const id = `gpt-toc-msg-${idx + 1}`;
      el.setAttribute(TARGET_ATTR, id);

      if (role === 'user' || (role === 'unknown' && entries.length === 0)) {
        turn += 1;
        entries.push({
          id,
          turn,
          role: 'user',
          text,
          preview: previewText(text),
          element: el
        });
      }
    });

    if (entries.length === 0) {
      const fallback = candidates
        .map((el, idx) => {
          const text = normalizeText(el.innerText);
          if (!text) return null;
          const id = `gpt-toc-fallback-${idx + 1}`;
          el.setAttribute(TARGET_ATTR, id);
          return {
            id,
            turn: idx + 1,
            role: 'unknown',
            text,
            preview: previewText(text),
            element: el
          };
        })
        .filter(Boolean)
        .slice(0, 200);

      return fallback;
    }

    return entries;
  }

  function clearList() {
    const list = document.getElementById('gpt-toc-list');
    if (list) list.innerHTML = '';
  }

  function clearIntersectionObserver() {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
  }

  function setActive(targetId) {
    document.querySelectorAll(`.${ITEM_CLASS}`).forEach(item => {
      item.classList.toggle(ITEM_ACTIVE_CLASS, item.dataset.targetId === targetId);
    });
  }

  function flashElement(el) {
    el.classList.add(HIGHLIGHT_CLASS);
    setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 1200);
  }

  function setupIntersectionObserver(entries) {
    clearIntersectionObserver();

    intersectionObserver = new IntersectionObserver((items) => {
      const visible = items
        .filter(item => item.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      if (visible.length > 0) {
        const targetId = visible[0].target.getAttribute(TARGET_ATTR);
        if (targetId) setActive(targetId);
      }
    }, {
      root: null,
      rootMargin: '-20% 0px -55% 0px',
      threshold: [0.15, 0.3, 0.5]
    });

    entries.forEach(entry => {
      if (entry.element) intersectionObserver.observe(entry.element);
    });
  }

  function renderEntries(entries) {
    const list = document.getElementById('gpt-toc-list');
    if (!list) return;

    list.innerHTML = '';

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '没有识别到可用对话。等页面加载完成后点“刷新”。';
      empty.style.fontSize = '13px';
      empty.style.opacity = '0.85';
      empty.style.padding = '8px';
      list.appendChild(empty);
      return;
    }

    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = ITEM_CLASS;
      item.dataset.targetId = entry.id;

      const label = document.createElement('div');
      label.className = 'gpt-toc-item-label';
      label.textContent = `第 ${entry.turn} 轮`;

      const content = document.createElement('div');
      content.textContent = entry.preview;

      item.appendChild(label);
      item.appendChild(content);

      item.addEventListener('click', () => {
        entry.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setActive(entry.id);
        flashElement(entry.element);
      });

      list.appendChild(item);
    });
  }

  function buildTOC() {
    ensureUI();
    applyTheme();

    currentEntries = getUserMessageEntries();
    setStatus(`识别到 ${currentEntries.length} 条目录项`);
    renderEntries(currentEntries);
    setupIntersectionObserver(currentEntries);

    log('TOC built:', currentEntries.length);
  }

  function observePage() {
    if (mutationObserver) mutationObserver.disconnect();

    mutationObserver = new MutationObserver(() => {
      applyTheme();

      if (location.href !== lastUrl) {
        lastUrl = location.href;
        debounceRebuild(700);
        return;
      }

      debounceRebuild(600);
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function startUrlWatcher() {
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        debounceRebuild(700);
      }
      applyTheme();
    }, 1000);
  }

  function init() {
    injectStyle();
    ensureUI();
    buildTOC();
    observePage();
    startUrlWatcher();

    window.addEventListener('resize', () => debounceRebuild(300));
    log('initialized');
  }

  setTimeout(init, 1500);
})();
