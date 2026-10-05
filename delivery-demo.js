// Browser-only sample data. Never calls order/delivery APIs or device GPS.
function startDeliveryDemo() {
  if (!isDemo) return;
  document.title = 'Delivery demo — DANK BKK';
  const panel = document.createElement('section');
  panel.className = 'error';
  panel.setAttribute('aria-label', 'Delivery demo controls');
  panel.innerHTML = '<b>Delivery test · simulated rider</b><p>No purchase or real rider needed. Start delivery, move through 20 sample locations, then complete. Positions and arrival times are simulated; the Google map is real. Automatic movement runs every 45 seconds.</p><div style="display:flex;flex-wrap:wrap;gap:8px;margin:14px 0"><button class="btn" data-demo="start">Start delivery</button><button class="btn" data-demo="next">Next location</button><button class="btn" data-demo="complete">Complete delivery</button><button class="btn secondary" data-demo="reset">Restart test</button></div><p role="status" id="demoProgress"></p>';
  document.querySelector('main').prepend(panel);
  const buttons = Object.fromEntries(['start', 'next', 'complete', 'reset'].map(action => [action, panel.querySelector('[data-demo="' + action + '"]')]));
  const path = Array.from({length: 20}, (_, i) => ({lat: 13.7463 - i * 0.0001, lng: 100.5346 + i * 0.0001}));
  let index = 0, movement, config = {key: '', mapId: 'DEMO_MAP_ID'};
  let state = 'preparing';
  function display() {
    const moving = state === 'on_the_way';
    render({orderId: 'DEMO-ONLY', status: state, completedAt: state === 'completed' ? Date.now() : null,
      destination: state === 'completed' ? null : path[19],
      location: moving ? {...path[index], capturedAt: Date.now(), route: {minutes: Math.max(1, 10 - Math.floor(index / 2))}} : null,
      stale: !moving, driver: state === 'completed' ? null : {name: 'Simulated rider', phone: '', photo: ''},
      items: [{name: 'Sample sandwich (test only)', qty: 1}], total: 100, reviewUrl: '',
      mapsKey: config.key, mapId: config.mapId});
    buttons.start.disabled = state !== 'preparing';
    buttons.next.disabled = !moving || index === 19;
    buttons.complete.disabled = !moving;
    panel.querySelector('#demoProgress').textContent = state === 'preparing' ? 'Step 1: order confirmed and preparing.' : state === 'completed' ? 'Step 3: completed. No review prompt. Restart to try again.' : 'Step 2: on the way · sample location ' + (index + 1) + ' of 20.';
  }
  function next() {if (state !== 'on_the_way') return; index = Math.min(19, index + 1); display(); if (index === 19) clearInterval(movement);}
  buttons.start.addEventListener('click', () => {state = 'on_the_way'; display(); movement = setInterval(next, 45000);});
  buttons.next.addEventListener('click', next);
  buttons.complete.addEventListener('click', () => {clearInterval(movement); state = 'completed'; display();});
  buttons.reset.addEventListener('click', () => {clearInterval(movement); state = 'preparing'; index = 0; display();});
  display();
  fetch('/api/maps-config', {cache: 'no-store', signal: AbortSignal.timeout(10000)})
    .then(response => {if (!response.ok) throw new Error('Map configuration unavailable'); return response.json();})
    .then(data => {config = {key: data.key || '', mapId: data.mapId || 'DEMO_MAP_ID'}; display();})
    .catch(() => {panel.querySelector('#demoProgress').textContent += ' Google map configuration could not load; reload to retry.';});
}
