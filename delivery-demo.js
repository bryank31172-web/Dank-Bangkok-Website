// Simulated rider on a fixed public Google road route; no orders or device GPS.
function startDeliveryDemo() {
  if (!isDemo) return;
  const replay = new URLSearchParams(location.search).get('replay') === '1';
  if(new URLSearchParams(location.hash.slice(1)).has("session")){startLinkedDeliveryDemo();return;}
  document.title = replay ? 'Animated delivery demo — DANK BKK' : 'Delivery demo — DANK BKK';
  const panel = document.createElement('section');
  panel.className = replay ? 'hidden' : 'error demo-panel';
  panel.setAttribute('aria-label', 'Delivery demo controls');
  panel.innerHTML = '<b>Delivery test · simulated rider</b><p>No purchase or real rider needed. Start delivery, move through 20 sample locations, then complete. Positions and arrival times are simulated; the Wayfinder map is real. Automatic movement runs every 90 seconds.</p><div style="display:flex;flex-wrap:wrap;gap:8px;margin:14px 0"><button class="btn" data-demo="start">Start delivery</button><button class="btn" data-demo="next">Next location</button><button class="btn" data-demo="complete">Complete delivery</button><button class="btn secondary" data-demo="reset">Restart test</button></div><p role="status" id="demoProgress"></p>';
  document.querySelector('main').prepend(panel);
  const buttons = Object.fromEntries(['start', 'next', 'complete', 'reset'].map(action => [action, panel.querySelector('[data-demo="' + action + '"]')]));
  let path = Array.from({length: 20}, (_, i) => ({lat: 13.7463 - i * 0.0001, lng: 100.5346 + i * 0.0001}));
  let roadRoute = null, fullPath = [], destination = path[19], destinationLabel = 'Delivery destination';
  let index = 0, movement, finishTimer;
  const movementInterval = replay ? 2000 : 90000;
  let state = 'preparing';
  function display() {
    const moving = state === 'on_the_way';
    const remaining = roadRoute ? {...roadRoute, minutes: Math.max(1, Math.round(roadRoute.minutes * (1 - index / 20))), km: Math.round(roadRoute.km * (1 - index / 20) * 10) / 10} : null;
    render({orderId: 'DEMO-ONLY', status: state, demo: true, destinationLabel, completedAt: state === 'completed' ? Date.now() : null,
      destination: state === 'completed' ? null : destination,
      location: moving ? {...path[index], capturedAt: Date.now(), route: remaining} : null,
      stale: !moving, driver: state === 'completed' ? null : {name: 'Simulated rider', phone: '', photo: ''},
      departurePhoto: state === 'completed' ? null : '/assets/delivery-demo-photo.svg', departureAt: Date.now(),
      items: [{name: 'Sample sandwich (test only)', qty: 1}], total: 100, reviewUrl: '',
      mapProvider: 'wayfinder'});
    buttons.start.disabled = state !== 'preparing';
    buttons.next.disabled = !moving || index === 19;
    buttons.complete.disabled = !moving;
    panel.querySelector('#demoProgress').textContent = state === 'preparing' ? 'Step 1: order confirmed and preparing.' : state === 'completed' ? 'Step 3: completed. No review prompt. Restart to try again.' : 'Step 2: on the way · sample location ' + (index + 1) + ' of 20.';
  }
  function next() {if (state !== 'on_the_way') return; index = Math.min(19, index + 1); display(); if (index === 19) {clearInterval(movement);if(replay){clearTimeout(finishTimer);finishTimer=setTimeout(()=>{if(state==='on_the_way'&&index===19){state='completed';display();}},5000);}}}
  buttons.start.addEventListener('click', () => {state = 'on_the_way'; display(); movement = setInterval(next, movementInterval);});
  buttons.next.addEventListener('click', next);
  buttons.complete.addEventListener('click', () => {clearInterval(movement);clearTimeout(finishTimer); state = 'completed'; display();});
  buttons.reset.addEventListener('click', () => {clearInterval(movement);clearTimeout(finishTimer); state = 'preparing'; index = 0; display();});
  display();
  fetch('/api/delivery?action=demo-route', {cache: 'default', signal: AbortSignal.timeout(10000)})
    .then(response => {if (!response.ok) throw new Error('Demo route unavailable'); return response.json();})
    .then(data => {
      if (!data.route?.polyline) throw new Error('Demo route unavailable');
      fullPath = decodeDeliveryRoute(data.route.polyline);
      if (fullPath.length < 2) throw new Error('Demo route unavailable');
      // Keep the simulated rider on Google's route geometry, including bends.
      path = Array.from({length: 20}, (_, i) => {
        const offset = i * (fullPath.length - 1) / 19, a = Math.floor(offset), b = Math.min(fullPath.length - 1, a + 1), fraction = offset - a;
        return {lat: fullPath[a].lat + (fullPath[b].lat - fullPath[a].lat) * fraction, lng: fullPath[a].lng + (fullPath[b].lng - fullPath[a].lng) * fraction};
      });
      destination = data.destination; path[19] = {...destination}; destinationLabel = data.destinationLabel; roadRoute = data.route; display(); if(replay)buttons.start.click();
    })
    .catch(() => {panel.querySelector('#demoProgress').textContent += ' Google road route unavailable. No estimated route is drawn.';});
}
