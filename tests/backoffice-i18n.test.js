import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/backoffice-i18n.js', import.meta.url), 'utf8');
const catalogs = Object.fromEntries(await Promise.all(['th', 'en', 'my'].map(async code => [
  code, JSON.parse(await fs.readFile(new URL('../assets/backoffice-locales/' + code + '.json', import.meta.url), 'utf8'))
])));

async function engine(saved = 'th') {
  const storage = new Map([['dankBOLanguage', saved]]);
  const context = {
    URL, Node: {ELEMENT_NODE:1, TEXT_NODE:3}, CustomEvent: class {},
    document: {currentScript:{src:'https://test.invalid/assets/backoffice-i18n.js'}, documentElement:{}, addEventListener() {}},
    localStorage:{getItem:key=>storage.get(key), setItem:(key,value)=>storage.set(key,value)},
    fetch:async url=>({ok:true,json:async()=>catalogs[url.pathname.split('/').at(-1).slice(0,-5)]}),
    console,
  };
  context.window = {alert() {}, confirm() {}, prompt() {}, dispatchEvent() {}};
  vm.runInNewContext(source, context);
  await context.window.BOI18n.ready;
  return {i18n:context.window.BOI18n, storage, document:context.document};
}

test('all languages contain the same keys and interpolation placeholders', () => {
  const keys = Object.keys(catalogs.en).sort();
  assert.ok(keys.length > 500);
  for (const language of ['th','my']) {
    assert.deepEqual(Object.keys(catalogs[language]).sort(), keys);
    for (const key of keys) {
      assert.ok(catalogs[language][key].trim(), key);
      const placeholders = text => (text.match(/\{\w+\}/g) || []).sort();
      assert.deepEqual(placeholders(catalogs[language][key]), placeholders(catalogs.en[key]), key);
    }
  }
});

test('language selection persists and translates original strings reversibly', async () => {
  const {i18n,storage,document} = await engine();
  await i18n.setLanguage('en');
  assert.equal(i18n.t('ภาพรวมธุรกิจ'), 'Business overview');
  assert.equal(i18n.t('ข้อมูลตัวอย่าง · 12 รายการ'), 'Sample data · 12 orders');
  assert.equal(i18n.t('MAC1'), 'MAC1');
  assert.equal(storage.get('dankBOLanguage'), 'en');
  assert.equal(document.documentElement.lang, 'en');
  await i18n.setLanguage('my');
  assert.equal(i18n.t('ภาพรวมธุรกิจ'), catalogs.my['Business overview']);
  await i18n.setLanguage('th');
  assert.equal(i18n.t('Business overview'), 'ภาพรวมธุรกิจ');
  await i18n.setLanguage('invalid');
  assert.equal(i18n.language, 'th');
});

test('unsupported saved languages fall back to Thai and formatted dates can change locale', async () => {
  const {i18n} = await engine('unsupported');
  assert.equal(i18n.language,'th');
  const value = new Date('2026-11-20T03:00:00Z');
  const options = {timeZone:'Asia/Bangkok', year:'numeric',month:'short',day:'numeric'};
  const original = i18n.formatDate(value,'toLocaleDateString',options);
  await i18n.setLanguage('en');
  assert.equal(i18n.t(original),value.toLocaleDateString('en-GB',options));
  assert.equal(i18n.t('DANK Pattanakarn (Main)'),'DANK Pattanakarn (Main)');
});
