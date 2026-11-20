/* One-time AI-authored UI translations. Data values keep their original language. */
(() => {
  'use strict';
  const supported = ['th', 'en', 'my'];
  const storageKey = 'dankBOLanguage';
  const root = new URL('backoffice-locales/', document.currentScript.src);
  let language = 'th';
  try {
    const saved = localStorage.getItem(storageKey);
    if (supported.includes(saved)) language = saved;
  } catch {}
  const dictionaries = {};
  const sources = new Map();
  const templates = [];
  const textRecords = new WeakMap();
  const attributeRecords = new WeakMap();
  const dates = new Map();
  let dialog;
  let observer;
  let ready;
  const normalize = text => String(text).replace(/\s+/g, ' ').trim();
  const locale = () => ({th:'th-TH-u-ca-gregory', en:'en-GB', my:'my-MM-u-ca-gregory'}[language]);
  const escapeRegex = text => text.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');

  function translate(value) {
    const source = normalize(value);
    const key = sources.get(source);
    if (key) return dictionaries[language]?.[key] ?? value;
    if (dates.has(source)) {
      const date = dates.get(source);
      return new Date(date.value)[date.method](locale(), date.options);
    }
    if (source.includes(' | ')) return source.split(' | ').map(translate).join(' | ');
    for (const template of templates) {
      const match = source.match(template.pattern);
      if (!match) continue;
      const destination = dictionaries[language]?.[template.key] ?? source;
      return destination.replace(/\{(\w+)\}/g, (placeholder, name) => {
        const captured = match[template.names.indexOf(name) + 1];
        if (captured === undefined) return placeholder;
        return ['error','date','range','status'].includes(name) && captured.length < source.length ? translate(captured) : captured;
      });
    }
    for (const separator of [' ~ ', ' – ']) {
      if (source.includes(separator)) {
        const parts = source.split(separator);
        if (parts.every(part => dates.has(part))) return parts.map(translate).join(separator);
      }
    }
    const suffix = source.match(/^(.*?)(\s*[:：*↕])$/);
    if (suffix && sources.has(suffix[1])) return translate(suffix[1]) + suffix[2];
    return value;
  }

  function skip(node) {
    const parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!parent || parent.closest('script,style,textarea,[translate="no"],[data-i18n-skip]')) return true;
    if (parent.closest('.member-card-name,.order-receipt-link,.product-order-link,.store-name-button')) return true;
    if (parent.closest('tbody td') && !parent.closest('button[data-act],.customer-recency,.order-type-pill,.badge,.empty-table,[data-i18n-ui]')) {
      if (node.nodeType !== Node.TEXT_NODE || !dates.has(normalize(textRecords.get(node)?.source ?? node.data))) return true;
    }
    return false;
  }

  function updateText(node) {
    if (skip(node) || !node.data.trim()) return;
    let record = textRecords.get(node);
    if (!record || node.data !== record.rendered) record = {source: node.data};
    const translated = translate(record.source);
    const whitespace = record.source.match(/^(\s*)[\s\S]*?(\s*)$/);
    record.rendered = translated === record.source ? record.source : whitespace[1] + translated + whitespace[2];
    if (node.data !== record.rendered) node.data = record.rendered;
    textRecords.set(node, record);
  }

  function updateElement(element) {
    if (skip(element)) return;
    // Preserve option identifiers before translating visible labels.
    if (element.tagName === 'OPTION' && !element.hasAttribute('value')) element.setAttribute('value', element.value);
    let records = attributeRecords.get(element);
    if (!records) { records = {}; attributeRecords.set(element, records); }
    for (const name of ['placeholder', 'aria-label', 'title', 'alt']) {
      const current = element.getAttribute(name);
      if (!current) continue;
      let record = records[name];
      if (!record || current !== record.rendered) record = {source: current};
      record.rendered = translate(record.source);
      if (current !== record.rendered) element.setAttribute(name, record.rendered);
      records[name] = record;
    }
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return updateText(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.closest('script,style,textarea,[translate="no"],[data-i18n-skip]')) return;
    updateElement(node);
    for (const child of node.childNodes) walk(child);
  }

  function observe() {
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['placeholder', 'aria-label', 'title', 'alt']
    });
  }

  function refresh() {
    if (!observer || !dictionaries[language]) return;
    observer.disconnect();
    walk(document.body);
    observe();
  }

  async function setLanguage(next) {
    if (!supported.includes(next)) return;
    await ready;
    language = next;
    document.documentElement.lang = next;
    try { localStorage.setItem(storageKey, next); } catch {}
    refresh();
    window.dispatchEvent(new CustomEvent('backoffice-language-change', {detail: next}));
  }

  function createDialog() {
    dialog = document.createElement('dialog');
    dialog.className = 'language-dialog';
    dialog.setAttribute('aria-labelledby', 'languageTitle');
    const flags = {
      th: '<svg viewBox="0 0 60 60" aria-hidden="true"><path fill="#a51931" d="M0 0h60v60H0z"/><path fill="#fff" d="M0 10h60v40H0z"/><path fill="#2d2a4a" d="M0 20h60v20H0z"/></svg>',
      en: '<svg viewBox="0 0 60 60" aria-hidden="true"><path fill="#012169" d="M0 0h60v60H0z"/><path stroke="#fff" stroke-width="12" d="m0 0 60 60m0-60L0 60"/><path stroke="#c8102e" stroke-width="5" d="m0 0 30 30m0 0 30-30m0 60L30 30m0 0L0 60"/><path stroke="#fff" stroke-width="20" d="M30 0v60M0 30h60"/><path stroke="#c8102e" stroke-width="12" d="M30 0v60M0 30h60"/></svg>',
      my: '<svg viewBox="0 0 60 60" aria-hidden="true"><path fill="#fecb00" d="M0 0h60v20H0z"/><path fill="#34b233" d="M0 20h60v20H0z"/><path fill="#ea2839" d="M0 40h60v20H0z"/><path fill="#fff" d="m30 10 4.7 14.5H50L37.6 33.5l4.7 14.5L30 39l-12.3 9 4.7-14.5L10 24.5h15.3z"/></svg>'
    };
    const options = [
      ['th', 'ไทย', 'Thai'],
      ['en', 'English', 'English'],
      ['my', 'မြန်မာ', 'Burmese']
    ].map(([code, native, name]) =>
      '<label class="language-option">' +
      '<span class="language-symbol" translate="no">' + flags[code] + '</span>' +
      '<span class="language-option-name" translate="no"><strong lang="' + code + '">' + native + '</strong><small>' + name + '</small></span>' +
      '<input type="radio" name="language" value="' + code + '" aria-label="' + name + '" required></label>'
    ).join('');
    dialog.innerHTML = '<form method="dialog">' +
      '<h2 id="languageTitle">เลือกภาษา</h2>' +
      '<fieldset aria-label="เลือกภาษา">' + options + '</fieldset>' +
      '<p id="languageError" role="alert"></p>' +
      '<footer><button type="button" class="btn ghost" data-language-cancel>ยกเลิก</button>' +
      '<button type="submit" class="btn language-apply">ใช้</button></footer></form>';
    document.body.append(dialog);
    dialog.querySelector('[data-language-cancel]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      try {
        await setLanguage(new FormData(event.currentTarget).get('language'));
        dialog.close();
      } catch {
        dialog.querySelector('#languageError').textContent = translate('Unable to load languages. Please try again.');
      } finally { button.disabled = false; }
    });
  }

  function open() {
    if (!dialog) createDialog();
    dialog.querySelector('input[value="' + language + '"]').checked = true;
    dialog.querySelector('#languageError').textContent = '';
    refresh();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('input:checked').focus();
  }

  function formatDate(value, method = 'toLocaleString', options) {
    const date = new Date(value);
    const rendered = date[method](locale(), options);
    // Register every locale's rendering so dates already on screen can switch languages too.
    for (const code of supported) {
      const targetLocale = {th:'th-TH-u-ca-gregory', en:'en-GB', my:'my-MM-u-ca-gregory'}[code];
      const text = date[method](targetLocale, options);
      dates.set(normalize(text), {value: date.getTime(), method, options});
    }
    return rendered;
  }

  window.BOI18n = {t: translate, locale, formatDate, open, setLanguage, refresh,
    get language() { return language; },
    get ready() { return ready; }
  };
  document.documentElement.lang = language;
  ready = Promise.all(supported.map(async code => {
    const response = await fetch(new URL(code + '.json', root), {cache:'no-cache'});
    if (!response.ok) throw Error('Language file unavailable');
    dictionaries[code] = await response.json();
  })).then(() => {
    for (const key of Object.keys(dictionaries.en)) {
      for (const code of supported) {
        const source = dictionaries[code][key];
        if (!source) continue;
        const normalized = normalize(source);
        if (!normalized.includes('{')) {
          if (!sources.has(normalized)) sources.set(normalized, key);
          continue;
        }
        const names = [];
        let previous = 0;
        let pattern = '^';
        for (const match of normalized.matchAll(/\{(\w+)\}/g)) {
          const numeric = ['count','first','last','page','row','total','sample','saved'].includes(match[1]);
          pattern += escapeRegex(normalized.slice(previous, match.index)) + (numeric ? '([0-9၀-၉.,+−-]+)' : '(.+?)');
          names.push(match[1]);
          previous = match.index + match[0].length;
        }
        pattern += escapeRegex(normalized.slice(previous)) + '$';
        templates.push({key, names, pattern: new RegExp(pattern)});
      }
    }
    for (const method of ['alert', 'confirm', 'prompt']) {
      const native = window[method].bind(window);
      window[method] = (message, ...args) => native(translate(message), ...args);
    }
    const start = () => {
      document.addEventListener('invalid', event => {
        const field = event.target;
        if (!field.validity || field.validity.customError) return;
        const message = field.validity.valueMissing ? 'Please fill out this field.'
          : field.validity.typeMismatch && field.type === 'email' ? 'Please enter a valid email address.'
          : 'Please enter a valid value.';
        field.setCustomValidity(translate(message));
        const clear = () => field.setCustomValidity('');
        field.addEventListener('input', clear, {once:true});
        field.addEventListener('change', clear, {once:true});
      }, true);
      observer = new MutationObserver(records => {
        observer.disconnect();
        for (const record of records) {
          if (record.type === 'childList') record.addedNodes.forEach(walk);
          else if (record.type === 'characterData') updateText(record.target);
          else updateElement(record.target);
        }
        observe();
      });
      refresh();
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, {once:true});
  });
  ready.catch(() => console.warn('BackOffice language files could not be loaded.'));
})();
