// Feature panels: pace lab, locations (+map), routes (+Strava), comments, weather.
import { el, clear, escapeHtml, relTime, initials, textOn, toast,
  paceToStr, strToPace, convertPace, fmtDuration, predictTime, KM_PER_MI,
  slotFullLabel, slotDateISO } from './util.js';
import { api } from './api.js';

function pmap(snap) {
  const m = new Map();
  for (const p of snap.participants) m.set(p.id, p);
  return m;
}

function avatar(p, size = 26) {
  return el('span', {
    class: 'avatar', title: p?.name || '?',
    style: { background: p?.color || '#888', color: textOn(p?.color || '#888888'),
      width: size + 'px', height: size + 'px', fontSize: (size * 0.42) + 'px' },
    text: initials(p?.name || '?'),
  });
}

function voteRow(voterIds, map) {
  const row = el('div', { class: 'vote-avatars' });
  voterIds.slice(0, 8).forEach(id => row.append(avatar(map.get(id), 22)));
  if (voterIds.length > 8) row.append(el('span', { class: 'more', text: `+${voterIds.length - 8}` }));
  return row;
}

// ---------------------------------------------------------------------------
// PACE LAB
// ---------------------------------------------------------------------------
export function renderPace(ctx) {
  const { ev, snap, me } = ctx;
  const unit = ev.paceUnit;
  const wrap = el('div', { class: 'panel-body pace-lab' });

  const withPace = snap.participants.filter(p => p.pace_seconds != null);
  const paces = withPace.map(p => p.pace_seconds).sort((a, b) => a - b);

  // --- your pace controls ---
  if (me) {
    const meP = snap.participants.find(p => p.id === me.id);
    const paceInput = el('input', { class: 'pace-input', type: 'text', placeholder: `mm:ss / ${unit}`,
      value: meP?.pace_seconds != null ? paceToStr(meP.pace_seconds) : '' });
    const distInput = el('input', { class: 'dist-input', type: 'number', min: '0', step: '0.5',
      placeholder: unit === 'km' ? 'km' : 'mi', value: meP?.distance_km != null ? round1(unit === 'km' ? meP.distance_km : meP.distance_km / KM_PER_MI) : '' });
    const save = el('button', { class: 'btn btn-sm', text: 'Save',
      onClick: async () => {
        const sec = strToPace(paceInput.value.trim());
        if (paceInput.value.trim() && sec == null) return toast('Pace must look like 5:30', 'error');
        const distVal = distInput.value === '' ? null : Number(distInput.value);
        const distKm = distVal == null ? null : (unit === 'km' ? distVal : distVal * KM_PER_MI);
        await api.setPrefs(ev.id, me.id, { paceSeconds: sec, distanceKm: distKm });
        toast('Pace saved'); ctx.refresh();
      } });
    wrap.append(el('div', { class: 'field-row' },
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: `Your goal pace (per ${unit})` }), paceInput),
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: 'Target distance' }), distInput),
      save,
    ));
  }

  // --- group consensus ---
  if (paces.length) {
    const min = paces[0], max = paces[paces.length - 1];
    const median = paces[Math.floor((paces.length - 1) / 2)];
    const noDropPace = max; // slowest sets the "no runner left behind" pace

    const stats = el('div', { class: 'pace-stats' },
      statCard('Fastest', paceToStr(min) + `/${unit}`, 'The quickest goal in the group'),
      statCard('Median', paceToStr(median) + `/${unit}`, 'Middle of the pack'),
      statCard('Group pace', paceToStr(noDropPace) + `/${unit}`, 'Keeps everyone together — nobody dropped', true),
    );
    wrap.append(stats);

    // distribution bars
    const chart = el('div', { class: 'pace-chart' });
    const span = Math.max(1, max - min);
    withPace.sort((a, b) => a.pace_seconds - b.pace_seconds).forEach(p => {
      const pct = 100 * (p.pace_seconds - min) / span;
      chart.append(el('div', { class: 'pace-bar-row' },
        avatar(p, 24),
        el('div', { class: 'pace-track' },
          el('div', { class: 'pace-dot', style: { left: `calc(${pct}% )`, background: p.color },
            title: `${p.name}: ${paceToStr(p.pace_seconds)}/${unit}` })),
        el('span', { class: 'pace-val', text: `${paceToStr(p.pace_seconds)}` }),
      ));
    });
    wrap.append(el('div', { class: 'subhead', text: 'Everyone’s goal pace' }), chart);

    // predicted split table for the group pace
    wrap.append(el('div', { class: 'subhead', text: 'Finish times at group pace' }));
    wrap.append(predictTable(noDropPace, unit));
  } else {
    wrap.append(el('p', { class: 'muted', text: 'No paces yet. Add yours above to build a group pace.' }));
  }

  // --- pace converter (always available) ---
  wrap.append(el('div', { class: 'subhead', text: 'Pace converter' }));
  const conv = el('div', { class: 'converter' });
  const kmIn = el('input', { class: 'pace-input', type: 'text', placeholder: '5:00' });
  const miOut = el('input', { class: 'pace-input', type: 'text', readonly: true, placeholder: 'min/mi' });
  const kmphOut = el('input', { class: 'pace-input', type: 'text', readonly: true, placeholder: 'km/h' });
  const recompute = () => {
    const sec = strToPace(kmIn.value.trim());
    if (sec == null) { miOut.value = ''; kmphOut.value = ''; return; }
    miOut.value = paceToStr(sec * KM_PER_MI) + ' /mi';
    kmphOut.value = (3600 / sec).toFixed(1) + ' km/h';
  };
  kmIn.addEventListener('input', recompute);
  conv.append(
    labeled('min/km', kmIn), el('span', { class: 'conv-eq', text: '=' }),
    labeled('min/mile', miOut), labeled('speed', kmphOut));
  wrap.append(conv);

  return wrap;
}

function round1(n) { return Math.round(n * 10) / 10; }
function labeled(label, input) {
  return el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), input);
}
function statCard(label, value, sub, hero) {
  return el('div', { class: 'stat-card' + (hero ? ' hero' : '') },
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'stat-value', text: value }),
    el('div', { class: 'stat-sub', text: sub }));
}
function predictTable(paceSec, unit) {
  const dists = unit === 'km'
    ? [['5K', 5], ['10K', 10], ['15K', 15], ['Half', 21.0975], ['Marathon', 42.195]]
    : [['5K', 3.10686], ['10K', 6.21371], ['10 mi', 10], ['Half', 13.1094], ['Marathon', 26.2188]];
  const t = el('table', { class: 'predict-table' });
  const head = el('tr', {}, el('th', { text: 'Distance' }), el('th', { text: 'Finish' }), el('th', { text: 'Pace' }));
  t.append(el('thead', {}, head));
  const body = el('tbody');
  for (const [name, d] of dists) {
    body.append(el('tr', {},
      el('td', { text: name }),
      el('td', { class: 'mono', text: fmtDuration(predictTime(paceSec, d)) }),
      el('td', { class: 'mono muted', text: `${paceToStr(paceSec)}/${unit}` })));
  }
  t.append(body);
  return t;
}

// ---------------------------------------------------------------------------
// LOCATIONS (+ Leaflet map + geocode search)
// ---------------------------------------------------------------------------
export function renderLocations(ctx) {
  const { ev, snap, me } = ctx;
  const map = pmap(snap);
  const wrap = el('div', { class: 'panel-body locations' });

  const mapEl = el('div', { class: 'leaflet-map', id: 'loc-map' });
  wrap.append(mapEl);

  const sorted = [...snap.locations].sort((a, b) => b.votes.length - a.votes.length || a.created_at - b.created_at);
  const list = el('div', { class: 'card-list' });
  if (!sorted.length) list.append(el('p', { class: 'muted', text: 'No locations suggested yet.' }));

  sorted.forEach((loc, i) => {
    const mine = me && loc.participant_id === me.id;
    const voted = me && loc.votes.includes(me.id);
    list.append(el('div', { class: 'sug-card' + (i === 0 && loc.votes.length ? ' leading' : '') },
      el('button', {
        class: 'vote-btn' + (voted ? ' voted' : ''), title: 'Vote',
        onClick: async () => { if (!me) return needJoin(); await api.voteLocation(ev.id, loc.id); ctx.refresh(); },
      }, el('span', { class: 'vote-caret', text: '▲' }), el('span', { class: 'vote-count', text: loc.votes.length })),
      el('div', { class: 'sug-main' },
        el('div', { class: 'sug-title' }, loc.name, i === 0 && loc.votes.length ? el('span', { class: 'pill lead', text: 'Leading' }) : null),
        loc.address ? el('div', { class: 'sug-sub', text: loc.address }) : null,
        loc.note ? el('div', { class: 'sug-note', text: loc.note }) : null,
        voteRow(loc.votes, map),
      ),
      el('div', { class: 'sug-actions' },
        loc.lat != null ? el('button', { class: 'icon-btn', title: 'Show on map', text: '📍',
          onClick: () => ctx._focusLoc?.(loc) }) : null,
        (mine || isAdmin(ev)) ? el('button', { class: 'icon-btn danger', title: 'Delete', text: '✕',
          onClick: async () => { await api.delLocation(ev.id, loc.id); ctx.refresh(); } }) : null,
      ),
    ));
  });
  wrap.append(list);

  // add form
  wrap.append(locationForm(ctx));

  // init map after mount
  queueMicrotask(() => initLocMap(ctx, sorted));
  return wrap;
}

function locationForm(ctx) {
  const { ev, me } = ctx;
  const name = el('input', { class: 'in', placeholder: 'Meetup spot (e.g. Park Gate)' });
  const search = el('input', { class: 'in', placeholder: 'Search an address / place…' });
  const note = el('input', { class: 'in', placeholder: 'Note (parking, water fountain…)' });
  const results = el('div', { class: 'geo-results' });
  let picked = null;

  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    const q = search.value.trim();
    if (q.length < 3) { clear(results); return; }
    t = setTimeout(async () => {
      try {
        const { results: rs } = await api.geocode(q);
        clear(results);
        rs.forEach(r => results.append(el('div', { class: 'geo-item', text: r.name,
          onClick: () => { picked = r; if (!name.value) name.value = r.name.split(',')[0]; search.value = r.name; clear(results);
            toast('Location pinned'); } })));
      } catch { /* ignore */ }
    }, 350);
  });

  const submit = el('button', { class: 'btn', text: 'Suggest location',
    onClick: async () => {
      if (!me) return needJoin();
      if (!name.value.trim()) return toast('Give it a name', 'error');
      await api.addLocation(ev.id, {
        name: name.value.trim(), address: picked?.name || '', note: note.value.trim(),
        lat: picked?.lat, lng: picked?.lng,
      });
      name.value = ''; search.value = ''; note.value = ''; picked = null;
      ctx.refresh();
    } });

  return el('div', { class: 'add-form' },
    el('div', { class: 'field-label', text: 'Suggest a meetup spot' }),
    name, el('div', { class: 'geo-wrap' }, search, results), note, submit);
}

let _locMap, _locMarkers = [];
function initLocMap(ctx, sorted) {
  if (typeof L === 'undefined') { document.getElementById('loc-map')?.replaceChildren(el('div', { class: 'map-fallback', text: 'Map unavailable offline' })); return; }
  const withCoords = sorted.filter(l => l.lat != null && l.lng != null);
  const mapDiv = document.getElementById('loc-map');
  if (!mapDiv) return;
  if (_locMap) { _locMap.remove(); _locMap = null; _locMarkers = []; }
  const center = withCoords[0] ? [withCoords[0].lat, withCoords[0].lng] : [40.758, -73.9855];
  _locMap = L.map(mapDiv, { scrollWheelZoom: false }).setView(center, withCoords.length ? 13 : 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 19,
  }).addTo(_locMap);
  const group = [];
  withCoords.forEach(l => {
    const m = L.marker([l.lat, l.lng]).addTo(_locMap)
      .bindPopup(`<b>${escapeHtml(l.name)}</b><br>${l.votes.length} vote${l.votes.length === 1 ? '' : 's'}`);
    _locMarkers.push({ id: l.id, m });
    group.push([l.lat, l.lng]);
  });
  if (group.length > 1) _locMap.fitBounds(group, { padding: [30, 30] });
  ctx._focusLoc = (loc) => {
    const entry = _locMarkers.find(x => x.id === loc.id);
    if (entry) { _locMap.setView([loc.lat, loc.lng], 15); entry.m.openPopup(); document.getElementById('loc-map').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  };
}

// ---------------------------------------------------------------------------
// ROUTES (+ Strava embeds + import)
// ---------------------------------------------------------------------------
export function renderRoutes(ctx) {
  const { ev, snap, me } = ctx;
  const map = pmap(snap);
  const wrap = el('div', { class: 'panel-body routes' });

  const sorted = [...snap.routes].sort((a, b) => b.votes.length - a.votes.length || a.created_at - b.created_at);
  const list = el('div', { class: 'card-list' });
  if (!sorted.length) list.append(el('p', { class: 'muted', text: 'No routes yet. Paste a Strava route or add your own.' }));

  sorted.forEach((rt, i) => {
    const mine = me && rt.participant_id === me.id;
    const voted = me && rt.votes.includes(me.id);
    const meta = [];
    if (rt.distance_km != null) meta.push(ev.paceUnit === 'km' ? `${round1(rt.distance_km)} km` : `${round1(rt.distance_km / KM_PER_MI)} mi`);
    if (rt.elevation_m != null) meta.push(`↑ ${Math.round(rt.elevation_m)} m`);
    if (rt.surface) meta.push(rt.surface);

    const card = el('div', { class: 'sug-card route-card' + (i === 0 && rt.votes.length ? ' leading' : '') },
      el('button', {
        class: 'vote-btn' + (voted ? ' voted' : ''),
        onClick: async () => { if (!me) return needJoin(); await api.voteRoute(ev.id, rt.id); ctx.refresh(); },
      }, el('span', { class: 'vote-caret', text: '▲' }), el('span', { class: 'vote-count', text: rt.votes.length })),
      el('div', { class: 'sug-main' },
        el('div', { class: 'sug-title' }, rt.name,
          rt.source === 'strava' ? el('span', { class: 'pill strava', text: 'Strava' }) : null,
          i === 0 && rt.votes.length ? el('span', { class: 'pill lead', text: 'Leading' }) : null),
        meta.length ? el('div', { class: 'sug-sub', text: meta.join('  ·  ') }) : null,
        rt.note ? el('div', { class: 'sug-note', text: rt.note }) : null,
        rt.source === 'strava' ? stravaEmbed(rt) : (rt.url ? el('a', { class: 'route-link', href: rt.url, target: '_blank', rel: 'noopener', text: 'Open route ↗' }) : null),
        voteRow(rt.votes, map),
      ),
      el('div', { class: 'sug-actions' },
        (mine || isAdmin(ev)) ? el('button', { class: 'icon-btn danger', title: 'Delete', text: '✕',
          onClick: async () => { await api.delRoute(ev.id, rt.id); ctx.refresh(); } }) : null,
      ),
    );
    list.append(card);
  });
  wrap.append(list);
  wrap.append(routeForm(ctx));
  queueMicrotask(bootStravaEmbeds);
  return wrap;
}

function stravaEmbed(rt) {
  const box = el('div', { class: 'strava-embed' });
  box.append(el('div', {
    class: 'strava-embed-placeholder',
    dataset: { embedType: rt.strava_type || 'route', embedId: rt.strava_id || '', style: 'standard' },
  }));
  box.append(el('a', { class: 'route-link small', href: rt.url, target: '_blank', rel: 'noopener', text: 'View on Strava ↗' }));
  return box;
}
function bootStravaEmbeds() {
  if (!document.querySelector('.strava-embed-placeholder')) return;
  const s = document.createElement('script');
  s.src = 'https://strava-embeds.com/embed.js';
  document.body.append(s);
  setTimeout(() => s.remove(), 4000);
}

function routeForm(ctx) {
  const { ev, me, snap } = ctx;
  const name = el('input', { class: 'in', placeholder: 'Route name' });
  const url = el('input', { class: 'in', placeholder: 'Strava route/activity URL (optional)' });
  const dist = el('input', { class: 'in', type: 'number', step: '0.1', min: '0', placeholder: ev.paceUnit });
  const elev = el('input', { class: 'in', type: 'number', step: '1', min: '0', placeholder: 'elev m' });
  const surface = el('select', { class: 'in' },
    el('option', { value: '', text: 'surface…' }),
    ...['road', 'trail', 'track', 'mixed'].map(s => el('option', { value: s, text: s })));
  const note = el('input', { class: 'in', placeholder: 'Note (loop, hilly, out-and-back…)' });

  const submit = el('button', { class: 'btn', text: 'Add route',
    onClick: async () => {
      if (!me) return needJoin();
      if (!name.value.trim()) return toast('Name the route', 'error');
      const distVal = dist.value === '' ? null : Number(dist.value);
      await api.addRoute(ev.id, {
        name: name.value.trim(), url: url.value.trim(),
        distanceKm: distVal == null ? null : (ev.paceUnit === 'km' ? distVal : distVal * KM_PER_MI),
        elevationM: elev.value === '' ? null : Number(elev.value),
        surface: surface.value, note: note.value.trim(),
      });
      [name, url, dist, elev, note].forEach(i => i.value = ''); surface.value = '';
      ctx.refresh();
    } });

  const form = el('div', { class: 'add-form' },
    el('div', { class: 'field-label', text: 'Add a route' }),
    name, url,
    el('div', { class: 'field-row tight' }, dist, elev, surface),
    note, submit);

  // Strava import (if server configured OR user already connected)
  const importBar = el('div', { class: 'strava-connect' });
  const stravaToken = sessionStorage.getItem('w2r:strava');
  if (stravaToken) {
    importBar.append(el('button', { class: 'btn btn-strava', text: '⚡ Import my Strava routes',
      onClick: () => importStrava(ctx, stravaToken) }));
  } else if (snap.stravaEnabled) {
    importBar.append(el('a', { class: 'btn btn-strava', href: `/auth/strava?event=${ev.id}`, text: '⚡ Connect Strava' }));
  } else {
    importBar.append(el('div', { class: 'strava-hint', html: 'Paste a Strava route link above to embed an interactive map. <span class="muted">(Full “import my routes” needs the server’s Strava API keys.)</span>' }));
  }
  form.prepend(importBar);
  return form;
}

async function importStrava(ctx, token) {
  try {
    toast('Fetching your Strava routes…');
    const { routes } = await api.stravaRoutes(token);
    if (!routes?.length) return toast('No Strava routes found', 'error');
    const picker = el('div', { class: 'modal-backdrop', onClick: (e) => { if (e.target.classList.contains('modal-backdrop')) e.target.remove(); } });
    const listEl = el('div', { class: 'modal' },
      el('h3', { text: 'Import a Strava route' }),
      ...routes.map(r => el('div', { class: 'strava-pick' },
        el('div', {}, el('strong', { text: r.name }),
          el('div', { class: 'muted', text: `${r.distance_km ? r.distance_km.toFixed(1) + ' km' : ''} ${r.elevation_m ? '· ↑' + Math.round(r.elevation_m) + 'm' : ''}` })),
        el('button', { class: 'btn btn-sm', text: 'Add', onClick: async () => {
          await api.addRoute(ctx.ev.id, { name: r.name, url: r.url, distanceKm: r.distance_km, elevationM: r.elevation_m });
          picker.remove(); ctx.refresh(); toast('Route added');
        } }))),
      el('button', { class: 'btn ghost', text: 'Close', onClick: () => picker.remove() }));
    picker.append(listEl);
    document.body.append(picker);
  } catch { toast('Strava import failed — token may have expired', 'error'); }
}

// ---------------------------------------------------------------------------
// COMMENTS
// ---------------------------------------------------------------------------
export function renderComments(ctx) {
  const { ev, snap, me } = ctx;
  const map = pmap(snap);
  const wrap = el('div', { class: 'panel-body comments' });
  const list = el('div', { class: 'comment-list' });
  if (!snap.comments.length) list.append(el('p', { class: 'muted', text: 'No messages yet. Say hi 👋' }));
  snap.comments.forEach(c => {
    const p = map.get(c.participant_id);
    list.append(el('div', { class: 'comment' },
      avatar(p || { name: c.author, color: '#888' }, 30),
      el('div', { class: 'comment-body' },
        el('div', { class: 'comment-head' },
          el('span', { class: 'comment-author', text: c.author }),
          el('span', { class: 'comment-time', text: relTime(c.created_at) })),
        el('div', { class: 'comment-text', text: c.body }))));
  });
  wrap.append(list);

  const input = el('input', { class: 'in', placeholder: me ? 'Write a message…' : 'Join to chat', disabled: !me,
    onKeydown: (e) => { if (e.key === 'Enter') send(); } });
  const send = async () => {
    if (!input.value.trim()) return;
    await api.addComment(ev.id, input.value.trim());
    input.value = ''; ctx.refresh();
  };
  wrap.append(el('div', { class: 'comment-compose' }, input,
    el('button', { class: 'btn', text: 'Send', disabled: !me, onClick: send })));
  return wrap;
}

// ---------------------------------------------------------------------------
// WEATHER (for the chosen slot + top location)
// ---------------------------------------------------------------------------
export async function renderWeather(ctx, slot) {
  const { ev, snap } = ctx;
  const topLoc = [...snap.locations].filter(l => l.lat != null)
    .sort((a, b) => b.votes.length - a.votes.length)[0];
  if (!topLoc || slot == null) return null;
  const date = slotDateISO(ev, slot);
  const wrap = el('div', { class: 'weather-card loading' }, el('span', { class: 'muted', text: 'Loading forecast…' }));
  (async () => {
    try {
      const data = await api.weather(topLoc.lat, topLoc.lng, date);
      const { minute } = decodeMinute(ev, slot);
      const idx = pickHour(data, date, minute);
      clear(wrap).classList.remove('loading');
      if (idx == null) { wrap.append(el('span', { class: 'muted', text: 'Forecast not available for that date' })); return; }
      const h = data.hourly;
      wrap.append(
        el('div', { class: 'wx-icon', text: wxEmoji(h.weathercode[idx]) }),
        el('div', {},
          el('div', { class: 'wx-temp', text: `${Math.round(h.temperature_2m[idx])}°C` }),
          el('div', { class: 'wx-sub', text: `feels ${Math.round(h.apparent_temperature[idx])}° · ${h.precipitation_probability[idx]}% rain · ${Math.round(h.wind_speed_10m[idx])} km/h wind` }),
          el('div', { class: 'wx-loc muted', text: `at ${topLoc.name}` })));
    } catch { clear(wrap).append(el('span', { class: 'muted', text: 'Forecast unavailable' })); }
  })();
  return wrap;
}
function decodeMinute(ev, slot) {
  const spd = Math.round((ev.timeEnd - ev.timeStart) / ev.slotMinutes);
  return { minute: ev.timeStart + (slot % spd) * ev.slotMinutes };
}
function pickHour(data, date, minute) {
  if (!data?.hourly?.time) return null;
  const hour = Math.floor(minute / 60);
  const target = `${date}T${String(hour).padStart(2, '0')}:00`;
  const i = data.hourly.time.indexOf(target);
  return i >= 0 ? i : null;
}
function wxEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------
function isAdmin(ev) { return Boolean(localStorage.getItem(`w2r:admin:${ev.id}`)); }
function needJoin() { toast('Enter your name first to participate', 'error'); document.getElementById('join-name')?.focus(); }
