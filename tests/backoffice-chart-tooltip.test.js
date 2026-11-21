import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('chart popup opens only on circle points and stays pinned until dismissed', () => {
  const html = fs.readFileSync(new URL('../backoffice.html', import.meta.url), 'utf8');
  const tooltip = { hidden: true, dataset: {}, style: {}, offsetWidth: 240, offsetHeight: 118 };
  const events = {};
  const windowEvents = {};
  const context = {
    BOI18n:{t:value=>value,formatDate:(value,method,options)=>new Date(value)[method]('th-TH-u-ca-gregory',options)},
    window: { innerWidth: 1440, innerHeight: 900, addEventListener: (name, callback) => { windowEvents[name] = callback; } },
    document: { addEventListener: (name, callback) => { events[name] = callback; } },
    $: () => tooltip,
    esc: value => String(value),
  };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('function hourLineChart('), html.indexOf('/* Donut over segments')), context);
  const labels = Array.from({ length: 12 }, (_, month) => String(month + 1));
  const chart = context.hourLineChart(new Array(11).fill(10000), new Array(12).fill(9000), {
    labels, currentLabel: 'ปีนี้', previousLabel: 'ปีที่แล้ว',
  });
  assert.equal((chart.match(/<circle /g) || []).length, 23);
  assert.equal((chart.match(/data-chart-index=/g) || []).length, 23);
  assert.equal(chart.includes('<rect'), false);
  assert(chart.includes('data-chart-label="ตุลาคม"'));

  function point() {
    const node = {
      dataset: { chartLabel: 'ตุลาคม', currentLabel: 'ปีนี้', previousLabel: 'ปีที่แล้ว', currentValue: '10000', previousValue: '9000' },
      attributes: {}, isConnected: true,
      setAttribute(name, value) { this.attributes[name] = value; },
      getBoundingClientRect: () => ({ right: 400, top: 100 }),
      closest: selector => selector === '[data-chart-index]' ? node : null,
    };
    return node;
  }
  const first = point();
  const second = point();
  const outside = { closest: () => null };
  const card = { closest: selector => selector === '#salesChartTooltip' ? tooltip : null };
  const event = target => ({ target, clientX: 600, clientY: 200 });

  events.pointermove(event(outside));
  assert.equal(tooltip.hidden, true);
  events.pointermove(event(first));
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.style.left, '616px');
  assert(tooltip.innerHTML.includes('ปีนี้: 10,000.00 บาท'));
  assert(tooltip.innerHTML.includes('ปีที่แล้ว: 9,000.00 บาท'));
  events.pointermove(event(outside));
  assert.equal(tooltip.hidden, true);

  events.click(event(first));
  assert.equal(tooltip.dataset.pinned, 'true');
  assert.equal(first.attributes['aria-pressed'], 'true');
  events.pointermove(event(outside));
  events.pointerout({ relatedTarget: null });
  events.focusout(event(first));
  windowEvents.blur();
  events.click(event(card));
  assert.equal(tooltip.hidden, false);

  events.click(event(second));
  assert.equal(first.attributes['aria-pressed'], 'false');
  assert.equal(second.attributes['aria-pressed'], 'true');
  windowEvents.scroll();
  assert.equal(tooltip.hidden, false);
  events.click(event(second));
  assert.equal(tooltip.hidden, true);
  assert.equal(second.attributes['aria-pressed'], 'false');

  events.keydown({ target: first, key: 'Enter', preventDefault() {} });
  assert.equal(tooltip.dataset.pinned, 'true');
  events.keydown({ key: 'Escape' });
  assert.equal(tooltip.hidden, true);
  events.click(event(first));
  events.click(event(outside));
  assert.equal(tooltip.hidden, true);
});
