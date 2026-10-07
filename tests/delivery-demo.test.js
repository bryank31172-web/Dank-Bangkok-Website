import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function browser(search) {
  class Element {
    constructor() {this.textContent = ''; this.attrs = {}; this.events = {}; this.hidden = new Set(); this.disabled = false; this.classList = {add: x => this.hidden.add(x), remove: x => this.hidden.delete(x), toggle: (x, v) => v ? this.hidden.add(x) : this.hidden.delete(x)};}
    setAttribute(k, v) {this.attrs[k] = v;}
    removeAttribute(k) {delete this.attrs[k];}
    focus() {}
    showModal() {this.open=true;}
    close() {this.open=false;this.events.close?.();}
    replaceChildren() {}
    appendChild() {}
    prepend() {}
    addEventListener(k, fn) {this.events[k] = fn;}
    click() {if (!this.disabled) this.events.click?.();}
    querySelector(selector) {return elements.get(selector);}
  }
  const elements = new Map(), requests = [], intervals = new Map(); let counter = 0;
  const get = key => {if (!elements.has(key)) elements.set(key, new Element()); return elements.get(key);};
  for (const action of ['start', 'next', 'complete', 'reset']) get('[data-demo="' + action + '"]');
  get('#demoProgress');
  const document = {hidden: false, head: new Element(), createElement: () => new Element(), getElementById: get, querySelector: get, addEventListener() {}};
  const context = vm.createContext({document, location: {search, hash: '#id=FAKE-ORDER&token=FAKE-TOKEN'}, URLSearchParams, AbortSignal, Date, console, Image: Element,
    setInterval(fn, delay) {const id = ++counter; intervals.set(id, {fn, delay}); return id;}, clearInterval(id) {intervals.delete(id);},
    fetch: async (url, options) => {requests.push({url, options}); return {ok: true, json: async () => url === '/api/maps-config' ? {key: 'test-browser-key', mapId: 'test-map'} : url === '/api/delivery?action=demo-route' ? {destination:{lat:43.252,lng:-126.453},destinationLabel:'Sample destination',route:{polyline:'_p~iF~ps|U_ulLnnqC_mqNvxq`@',minutes:10,km:5}} : {orderId: 'FAKE-ORDER', status: 'preparing', items: [], total: 0}};}});
  context.window = context;
  const html = readFileSync(new URL('../delivery.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(readFileSync(new URL('../delivery-map.js', import.meta.url), 'utf8'), context);
  vm.runInContext(script, context);
  vm.runInContext(readFileSync(new URL('../delivery-demo.js', import.meta.url), 'utf8'), context);
  return {context, elements, requests, intervals, get, html};
}

test('demo walks through all 20 positions and completion without live order or GPS access', async () => {
  const b = browser('?demo=1');
  vm.runInContext('startDeliveryDemo()', b.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext('last.status', b.context), 'preparing');
  b.get('[data-demo="start"]').click();
  assert.equal(vm.runInContext('last.status', b.context), 'on_the_way');
  const positions = [vm.runInContext('last.location.lng', b.context)];
  for (let i = 1; i < 20; i++) {b.get('[data-demo="next"]').click(); positions.push(vm.runInContext('last.location.lng', b.context));}
  assert.equal(new Set(positions).size, 20);
  assert.equal(b.get('[data-demo="next"]').disabled, true);
  assert.match(b.get('#demoProgress').textContent, /20 of 20/);
  assert.match(b.get('eta').textContent, /Simulated arrival/);
  assert.equal(b.get('call').hidden.has('hidden'), false);
  assert.equal(b.get('call').href, 'tel:+66841620610');
  b.get('[data-demo="complete"]').click();
  assert.equal(vm.runInContext('last.status', b.context), 'completed');
  assert.equal(vm.runInContext('last.location', b.context), null);
  assert.equal(vm.runInContext('last.driver', b.context), null);
  assert.equal(b.get('completed').hidden.has('hidden'), false);
  assert.doesNotMatch(b.html, /id="review"/);
  b.get('[data-demo="reset"]').click();
  assert.equal(vm.runInContext('last.status', b.context), 'preparing');
  // Visibility changes and explicit refreshes must never request live delivery data.
  await vm.runInContext('poll()', b.context);
  assert.deepEqual(b.requests.map(r => r.url), ['/api/delivery?action=demo-route']);
  assert.equal(b.requests[0].options.method, undefined);
});

test('demo moves every 45 seconds and stops movement when completed', async () => {
  const b = browser('?demo=1'); vm.runInContext('startDeliveryDemo()', b.context);
  await new Promise(resolve => setImmediate(resolve));
  b.get('[data-demo="start"]').click();
  const movement = [...b.intervals.values()].find(x => x.delay === 45000);
  assert.ok(movement); movement.fn();
  assert.match(b.get('#demoProgress').textContent, /2 of 20/);
  b.get('[data-demo="complete"]').click();
  assert.equal([...b.intervals.values()].some(x => x.delay === 45000), false);
  movement.fn(); assert.equal(vm.runInContext('last.status', b.context), 'completed');
});

test('normal private tracking retains live lookup and does not initialize demo', async () => {
  const b = browser(''); vm.runInContext('startDeliveryDemo()', b.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].url, '/api/delivery?id=FAKE-ORDER');
  assert.equal(b.requests[0].options.headers['X-Delivery-Token'], 'FAKE-TOKEN');
  assert.equal(b.context.document.title, undefined);
});

 test('customer opens departure image and completion closes and clears it', async()=>{
 const b=browser('?demo=1');vm.runInContext('startDeliveryDemo()',b.context);await new Promise(resolve=>setImmediate(resolve));b.get('[data-demo="start"]').click();assert.equal(b.get('photoButton').disabled,false);b.get('viewDeparture').click();assert.equal(b.get('photoDialog').open,true);assert.match(b.get('departureFull').src,/delivery-demo-photo/);b.get('[data-demo="complete"]').click();assert.equal(b.get('photoDialog').open,false);assert.equal(b.get('viewDeparture').disabled,true);
 });
