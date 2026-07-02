// when2run — router, event creation, scheduler view, live polling.
import { el, clear, $, minutesToLabel, slotsPerDay, decodeSlot, encodeSlot,
  slotFullLabel, slotDateISO, toast, initials, textOn, escapeHtml } from './util.js';
import { api, identity } from './api.js';
import { AvailabilityGrid } from './grid.js';
import { renderPace, renderLocations, renderRoutes, renderComments, renderWeather } from './panels.js';

const root = () => document.getElementById('app');

// ---- theme ----------------------------------------------------------------
function initTheme() {
  const saved = localStorage.getItem('w2r:theme');
  const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('w2r:theme', next);
}

// capture Strava token handed back via URL fragment
function captureStrava() {
  const m = location.hash.match(/strava_token=([^&]+)/);
  if (m && m[1]) {
    sessionStorage.setItem('w2r:strava', decodeURIComponent(m[1]));
    history.replaceState(null, '', location.pathname);
    toast('Strava connected ⚡');
  }
}

// ---- router ---------------------------------------------------------------
function navigate(path) { history.pushState({}, '', path); route(); }
window.addEventListener('popstate', route);
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a) { e.preventDefault(); navigate(a.getAttribute('href')); }
});

function route() {
  const path = location.pathname;
  const m = path.match(/^\/e\/([a-z0-9]+)/i);
  if (m) return renderEvent(m[1]);
  renderHome();
}

// ===========================================================================
// HOME — create an event
// ===========================================================================
function renderHome() {
  stopPolling();
  const app = clear(root());

  const selectedDates = new Set();
  const selectedDays = new Set();
  let mode = 'dates';

  // month calendar state
  const today = new Date();
  let viewY = today.getFullYear(), viewM = today.getMonth();

  const calWrap = el('div', { class: 'calendar' });
  function drawCal() {
    clear(calWrap);
    const first = new Date(viewY, viewM, 1);
    const start = first.getDay();
    const days = new Date(viewY, viewM + 1, 0).getDate();
    const header = el('div', { class: 'cal-head' },
      el('button', { class: 'icon-btn', text: '‹', type: 'button', onClick: () => { viewM--; if (viewM < 0) { viewM = 11; viewY--; } drawCal(); } }),
      el('span', { class: 'cal-title', text: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }),
      el('button', { class: 'icon-btn', text: '›', type: 'button', onClick: () => { viewM++; if (viewM > 11) { viewM = 0; viewY++; } drawCal(); } }));
    const gridc = el('div', { class: 'cal-grid' });
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(d => gridc.append(el('div', { class: 'cal-dow', text: d })));
    for (let i = 0; i < start; i++) gridc.append(el('div', {}));
    for (let d = 1; d <= days; d++) {
      const iso = `${viewY}-${String(viewM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const past = new Date(viewY, viewM, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const cell = el('button', { type: 'button', class: 'cal-day' + (selectedDates.has(iso) ? ' sel' : '') + (past ? ' past' : ''), text: d,
        onClick: () => { if (selectedDates.has(iso)) selectedDates.delete(iso); else selectedDates.add(iso); drawCal(); } });
      gridc.append(cell);
    }
    calWrap.append(header, gridc);
  }
  drawCal();

  const dowWrap = el('div', { class: 'dow-picker hidden' },
    ...['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) =>
      el('button', { type: 'button', class: 'dow-btn', text: d, onClick: (e) => {
        if (selectedDays.has(i)) selectedDays.delete(i); else selectedDays.add(i);
        e.currentTarget.classList.toggle('sel');
      } })));

  const modeTabs = el('div', { class: 'seg' },
    el('button', { type: 'button', class: 'seg-btn active', text: 'Specific dates', onClick: (e) => { mode = 'dates'; setSeg(e); calWrap.classList.remove('hidden'); dowWrap.classList.add('hidden'); } }),
    el('button', { type: 'button', class: 'seg-btn', text: 'Days of week', onClick: (e) => { mode = 'days'; setSeg(e); calWrap.classList.add('hidden'); dowWrap.classList.remove('hidden'); } }));
  function setSeg(e) { [...modeTabs.children].forEach(b => b.classList.remove('active')); e.currentTarget.classList.add('active'); }

  const title = el('input', { class: 'in big', placeholder: 'Saturday Long Run', maxlength: 120 });
  const desc = el('textarea', { class: 'in', rows: 2, placeholder: 'Optional details — meet-up vibe, distance goal, coffee after…' });

  const timeStart = timeSelect(6 * 60);
  const timeEnd = timeSelect(20 * 60);
  const slotSel = el('select', { class: 'in' },
    el('option', { value: 15, text: '15 min' }),
    el('option', { value: 30, text: '30 min', selected: true }),
    el('option', { value: 60, text: '60 min' }));
  const unitSel = el('select', { class: 'in' },
    el('option', { value: 'km', text: 'min / km' }),
    el('option', { value: 'mi', text: 'min / mile' }));

  const create = el('button', { class: 'btn btn-lg', text: 'Create run  →',
    onClick: async () => {
      const dates = mode === 'dates' ? [...selectedDates].sort() : [...selectedDays].sort().map(String);
      if (!dates.length) return toast(mode === 'dates' ? 'Pick at least one date' : 'Pick at least one day', 'error');
      if (Number(timeEnd.value) <= Number(timeStart.value)) return toast('End time must be after start', 'error');
      create.disabled = true; create.textContent = 'Creating…';
      try {
        const { id, adminToken } = await api.createEvent({
          title: title.value.trim(), description: desc.value.trim(),
          dateType: mode, dates,
          timeStart: Number(timeStart.value), timeEnd: Number(timeEnd.value),
          slotMinutes: Number(slotSel.value), paceUnit: unitSel.value,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        identity.setAdmin(id, adminToken);
        navigate(`/e/${id}`);
      } catch (err) { create.disabled = false; create.textContent = 'Create run  →'; toast('Could not create event', 'error'); }
    } });

  app.append(
    topbar(),
    el('div', { class: 'home' },
      el('section', { class: 'hero' },
        el('h1', { class: 'hero-title', html: 'Find the time to <span class="grad">run together</span>.' }),
        el('p', { class: 'hero-sub', text: 'when2run is when2meet for runners — line up the time, then agree on a place, a pace, and a route (with Strava). No sign-up. Share one link.' }),
        el('div', { class: 'hero-badges' },
          badge('🗓️', 'Group availability heatmap'),
          badge('📍', 'Vote on meetup spots'),
          badge('⚡', 'Strava routes'),
          badge('🏃', 'Group pace calculator'),
          badge('🌦️', 'Run-time weather')),
      ),
      el('section', { class: 'create-card' },
        el('h2', { text: 'Start a run' }),
        field('What’s the run?', title),
        field('Details (optional)', desc),
        el('div', { class: 'field-label', text: 'Which days work?' }),
        modeTabs, calWrap, dowWrap,
        el('div', { class: 'field-row' },
          field('Earliest', timeStart), field('Latest', timeEnd),
          field('Slot size', slotSel), field('Pace unit', unitSel)),
        create,
      ),
    ),
    footer());
}

function timeSelect(defaultMin) {
  const s = el('select', { class: 'in' });
  for (let m = 0; m <= 1440; m += 30) {
    if (m === 1440) { s.append(el('option', { value: 1440, text: 'Midnight' })); break; }
    s.append(el('option', { value: m, text: minutesToLabel(m), selected: m === defaultMin }));
  }
  return s;
}
function field(label, input) { return el('label', { class: 'field' }, el('span', { class: 'field-label', text: label }), input); }
function badge(icon, text) { return el('div', { class: 'badge' }, el('span', { class: 'badge-icon', text: icon }), text); }

// ===========================================================================
// EVENT view
// ===========================================================================
let current = { id: null, snap: null, version: -1, grids: {}, activeTab: 'pace', hoverSlot: null };

async function renderEvent(id) {
  captureStrava();
  current = { id, snap: null, version: -1, grids: {}, activeTab: current.activeTab || 'pace', hoverSlot: null };
  const app = clear(root());
  app.append(topbar(), el('div', { class: 'loading-screen', id: 'ev-root' }, el('div', { class: 'spinner' })));
  try {
    const snap = await api.getEvent(id);
    current.snap = snap; current.version = snap.version;
    paintEvent();
    startPolling(id);
  } catch (err) {
    clear($('#ev-root')).append(el('div', { class: 'empty' },
      el('h2', { text: 'Run not found' }),
      el('p', { class: 'muted', text: 'This link may be wrong or the event was removed.' }),
      el('a', { class: 'btn', href: '/', 'data-link': true, text: 'Create a new run' })));
  }
}

function me() {
  const snap = current.snap;
  const idn = identity.get(current.id);
  if (!idn) return null;
  const exists = snap.participants.find(p => p.id === idn.id);
  return exists ? idn : null;
}

function ctx() {
  return {
    ev: current.snap, snap: current.snap, me: me(),
    refresh: () => reloadSnapshot(true),
  };
}

function computeCounts(snap) {
  const counts = new Map();
  let max = 0;
  for (const [slot, ids] of Object.entries(snap.availability)) {
    const n = ids.length; counts.set(Number(slot), n); if (n > max) max = n;
  }
  const best = new Set();
  if (max > 0) for (const [slot, n] of counts) if (n === max) best.add(slot);
  return { counts, max, best };
}

function paintEvent() {
  const snap = current.snap;
  // tear down old grids' global listeners before rebuilding (avoid leaks)
  current.grids.edit?.destroy?.();
  current.grids.heat?.destroy?.();
  const host = clear($('#ev-root') || root().appendChild(el('div', { id: 'ev-root' })));
  const { counts, max, best } = computeCounts(snap);
  const total = snap.participants.length;
  const myId = me();

  // ---- header ----
  const bestSlot = pickBestSlot(snap, counts, max);
  const finalized = snap.finalizedSlot;
  const focusSlot = finalized ?? bestSlot;

  const header = el('header', { class: 'ev-header' },
    el('div', { class: 'ev-head-main' },
      el('h1', { class: 'ev-title', text: snap.title }),
      snap.description ? el('p', { class: 'ev-desc', text: snap.description }) : null,
      el('div', { class: 'ev-meta' },
        el('span', { class: 'meta-chip', text: `${total} runner${total === 1 ? '' : 's'}` }),
        el('span', { class: 'meta-chip', text: `${snap.dates.length} day${snap.dates.length === 1 ? '' : 's'}` }),
        snap.timezone ? el('span', { class: 'meta-chip', text: snap.timezone.replace('_', ' ') }) : null)),
    el('div', { class: 'ev-head-actions' },
      el('button', { class: 'btn ghost', text: '🔗 Share', onClick: shareLink }),
      isAdmin() ? el('button', { class: 'btn ghost', text: '⚙︎', title: 'Admin', onClick: () => adminMenu(focusSlot) }) : null),
  );

  // ---- best-time banner ----
  const banner = el('div', { class: 'best-banner' });
  if (max > 0 && focusSlot != null) {
    banner.append(
      el('div', { class: 'best-left' },
        el('div', { class: 'best-eyebrow', text: finalized != null ? '✅ Locked in' : '⭐ Best time so far' }),
        el('div', { class: 'best-time', text: slotFullLabel(snap, focusSlot) }),
        el('div', { class: 'best-sub', text: finalized != null ? 'The organizer locked this slot.' : `${counts.get(focusSlot) || 0} of ${total} runners available` })),
      el('div', { class: 'best-right', id: 'best-weather' }),
      el('div', { class: 'best-actions' },
        el('button', { class: 'btn btn-sm', text: '📅 Add to calendar', onClick: () => downloadICS(snap, focusSlot) })),
    );
    // weather async
    renderWeather(ctx(), focusSlot).then(node => { if (node) clear($('#best-weather')).append(node); });
  } else {
    banner.append(el('div', { class: 'best-left' },
      el('div', { class: 'best-eyebrow', text: 'No availability yet' }),
      el('div', { class: 'best-sub', text: 'Add your times below to start the heatmap.' })));
  }

  // ---- identity / join ----
  const idbar = renderIdentity();

  // ---- scheduler (two grids + responders) ----
  const scheduler = el('section', { class: 'scheduler' });

  const respSidebar = el('aside', { class: 'responders' },
    el('div', { class: 'resp-title', text: 'Available' }),
    el('div', { class: 'resp-lists', id: 'resp-lists' }));

  const heatGrid = new AvailabilityGrid(snap, {
    mode: 'heat', counts, total, bestSlots: best,
    onClickSlot: (slot) => { if (isAdmin()) confirmFinalize(slot); },
  });
  current.grids.heat = heatGrid;
  heatGrid.bindHeatHover((slot) => updateResponders(slot ?? focusSlot));

  const gridCols = el('div', { class: 'grid-cols' });

  if (myId) {
    const editGrid = new AvailabilityGrid(snap, {
      mode: 'edit', mySlots: snap.availability ? slotsForMe(snap, myId.id) : [],
      onChange: async (slots) => {
        try {
          await api.setAvailability(current.id, myId.id, slots);
          // reflect my own paint locally, then re-render everything consistently
          const s = current.snap;
          for (const k of Object.keys(s.availability)) {
            s.availability[k] = s.availability[k].filter(pid => pid !== myId.id);
            if (!s.availability[k].length) delete s.availability[k];
          }
          for (const slot of slots) (s.availability[slot] ||= []).push(myId.id);
          paintEvent();
          flashSaved();
        } catch { toast('Could not save', 'error'); }
      },
    });
    current.grids.edit = editGrid;
    gridCols.append(
      el('div', { class: 'grid-col' }, el('div', { class: 'grid-col-head' }, el('span', { text: '🖊️ Your availability' }), el('span', { class: 'saved-tag', id: 'saved-tag' })), paintHint(), editGrid.el),
      el('div', { class: 'grid-col' }, el('div', { class: 'grid-col-head' }, el('span', { text: '👥 Group heatmap' }), heatLegend(total)), heatGrid.el));
  } else {
    gridCols.append(el('div', { class: 'grid-col full' },
      el('div', { class: 'grid-col-head' }, el('span', { text: '👥 Group heatmap' }), heatLegend(total)),
      el('p', { class: 'muted small', text: 'Enter your name above to paint your availability.' }),
      heatGrid.el));
  }

  scheduler.append(el('div', { class: 'scheduler-grid' }, gridCols, respSidebar));

  // ---- participants ----
  const roster = renderRoster();

  // ---- tabbed panels ----
  const tabs = el('div', { class: 'tabs' });
  const tabDefs = [
    ['pace', '🏃 Pace', renderPace],
    ['locations', '📍 Locations', renderLocations],
    ['routes', '🗺️ Routes', renderRoutes],
    ['chat', `💬 Chat${snap.comments.length ? ` (${snap.comments.length})` : ''}`, renderComments],
  ];
  const panelHost = el('div', { class: 'panel-host' });
  const drawPanel = () => {
    clear(panelHost).append(tabDefs.find(t => t[0] === current.activeTab)[2](ctx()));
  };
  tabDefs.forEach(([key, label]) => tabs.append(el('button', {
    class: 'tab' + (current.activeTab === key ? ' active' : ''), text: label,
    onClick: () => { current.activeTab = key; [...tabs.children].forEach(b => b.classList.remove('active')); event.currentTarget?.classList.add('active'); drawPanel(); },
  })));

  const panels = el('section', { class: 'panels card' }, tabs, panelHost);

  host.append(header, banner, idbar, scheduler, roster, panels, footer());
  drawPanel();
  updateResponders(focusSlot);
}

function paintHint() { return el('div', { class: 'paint-hint muted small', text: 'Click & drag to paint the times you can run.' }); }
function heatLegend(total) {
  return el('div', { class: 'legend' },
    el('span', { class: 'legend-label', text: '0' }),
    el('span', { class: 'legend-bar' }),
    el('span', { class: 'legend-label', text: String(total || 0) }));
}

function slotsForMe(snap, myId) {
  const out = [];
  for (const [slot, ids] of Object.entries(snap.availability)) if (ids.includes(myId)) out.push(Number(slot));
  return out;
}

function pickBestSlot(snap, counts, max) {
  if (max <= 0) return null;
  let best = null;
  for (const [slot, n] of counts) if (n === max && (best == null || slot < best)) best = slot;
  return best;
}

function updateResponders(slot) {
  const snap = current.snap;
  const host = $('#resp-lists'); if (!host) return;
  clear(host);
  const title = $('.resp-title');
  if (slot == null) { if (title) title.textContent = 'Available'; host.append(el('p', { class: 'muted small', text: 'Hover the heatmap to see who’s free.' })); return; }
  if (title) title.textContent = slotFullLabel(snap, slot);
  const ids = new Set(snap.availability[slot] || []);
  const yes = snap.participants.filter(p => ids.has(p.id));
  const no = snap.participants.filter(p => !ids.has(p.id));
  host.append(el('div', { class: 'resp-group' },
    el('div', { class: 'resp-count avail', text: `Available (${yes.length})` }),
    el('div', { class: 'resp-chips' }, ...yes.map(p => chip(p, true)))));
  if (no.length) host.append(el('div', { class: 'resp-group' },
    el('div', { class: 'resp-count', text: `Can’t make it (${no.length})` }),
    el('div', { class: 'resp-chips' }, ...no.map(p => chip(p, false)))));
}
function chip(p, on) {
  return el('span', { class: 'name-chip' + (on ? '' : ' off'), style: on ? { background: p.color, color: textOn(p.color) } : {} },
    el('span', { class: 'name-dot', style: { background: p.color } }), p.name);
}

// ---- identity / join ------------------------------------------------------
function renderIdentity() {
  const idn = me();
  const bar = el('div', { class: 'id-bar card' });
  if (idn) {
    const p = current.snap.participants.find(x => x.id === idn.id);
    bar.append(
      el('div', { class: 'id-me' },
        el('span', { class: 'avatar', style: { background: p.color, color: textOn(p.color) }, text: initials(p.name) }),
        el('div', {}, el('div', { class: 'id-name', text: p.name }), el('div', { class: 'muted small', text: 'You’re signed in for this run' }))),
      el('div', { class: 'id-actions' },
        rsvpToggle(p),
        el('button', { class: 'btn ghost sm', text: 'Sign out', onClick: () => { identity.clear(current.id); reloadSnapshot(true); } })));
  } else {
    const name = el('input', { class: 'in', id: 'join-name', placeholder: 'Your name', maxlength: 40, onKeydown: (e) => { if (e.key === 'Enter') join(); } });
    const pin = el('input', { class: 'in', id: 'join-pin', type: 'password', placeholder: 'PIN (optional)', maxlength: 20 });
    const join = async () => {
      if (!name.value.trim()) return toast('Enter your name', 'error');
      try {
        const res = await api.join(current.id, { name: name.value.trim(), pin: pin.value || undefined });
        identity.set(current.id, { id: res.participant.id, token: res.token, name: res.participant.name });
        reloadSnapshot(true);
      } catch (err) {
        if (err.status === 401) toast('Wrong PIN for that name', 'error');
        else toast('Could not join', 'error');
      }
    };
    bar.append(
      el('div', { class: 'join-lead' }, el('strong', { text: 'Join this run' }), el('span', { class: 'muted small', text: 'Add your name to paint availability & vote. A PIN protects your entry.' })),
      el('div', { class: 'join-form' }, name, pin, el('button', { class: 'btn', text: 'Join', onClick: join })));
  }
  return bar;
}

function rsvpToggle(p) {
  const opts = [['yes', '✅ In'], ['maybe', '🤔 Maybe'], ['no', '❌ Out']];
  const seg = el('div', { class: 'seg small' });
  opts.forEach(([val, label]) => seg.append(el('button', {
    class: 'seg-btn' + (p.rsvp === val ? ' active' : ''), text: label,
    onClick: async () => { await api.setPrefs(current.id, p.id, { rsvp: val }); reloadSnapshot(true); },
  })));
  return seg;
}

// ---- roster ---------------------------------------------------------------
function renderRoster() {
  const snap = current.snap;
  const wrap = el('section', { class: 'roster card' },
    el('div', { class: 'roster-head' }, el('h3', { text: 'Runners' }), el('span', { class: 'muted small', text: `${snap.participants.length} joined` })));
  const list = el('div', { class: 'roster-list' });
  if (!snap.participants.length) list.append(el('p', { class: 'muted', text: 'Nobody yet — be the first to join!' }));
  const rsvpIcon = { yes: '✅', maybe: '🤔', no: '❌' };
  const availCount = (pid) => { let n = 0; for (const ids of Object.values(snap.availability)) if (ids.includes(pid)) n++; return n; };
  snap.participants.forEach(p => {
    const mine = me()?.id === p.id;
    list.append(el('div', { class: 'roster-item' },
      el('span', { class: 'avatar', style: { background: p.color, color: textOn(p.color) }, text: initials(p.name) }),
      el('div', { class: 'roster-info' },
        el('div', { class: 'roster-name' }, p.name, mine ? el('span', { class: 'pill you', text: 'you' }) : null, p.locked ? el('span', { class: 'lock', title: 'PIN-protected', text: '🔒' }) : null),
        el('div', { class: 'roster-sub muted small', text: `${rsvpIcon[p.rsvp] || ''} ${availCount(p.id)} slots${p.pace_seconds ? ` · ${paceStr(p.pace_seconds)}/${snap.paceUnit}` : ''}` })),
      (isAdmin() && !mine) ? el('button', { class: 'icon-btn danger', title: 'Remove', text: '✕', onClick: async () => { if (confirm(`Remove ${p.name}?`)) { await api.removeParticipant(current.id, p.id); reloadSnapshot(true); } } }) : null));
  });
  wrap.append(list);
  return wrap;
}
function paceStr(sec) { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return `${m}:${String(s).padStart(2, '0')}`; }

// ---- admin ----------------------------------------------------------------
function isAdmin() { return Boolean(identity.admin(current.id)); }
function confirmFinalize(slot) {
  if (confirm(`Lock in ${slotFullLabel(current.snap, slot)} as the run time?`)) {
    api.patchEvent(current.id, { finalizedSlot: slot }).then(() => reloadSnapshot(true));
  }
}
function adminMenu(focusSlot) {
  const backdrop = el('div', { class: 'modal-backdrop', onClick: (e) => { if (e.target === backdrop) backdrop.remove(); } });
  const m = el('div', { class: 'modal' },
    el('h3', { text: 'Organizer controls' }),
    el('p', { class: 'muted small', text: 'Only you (this browser) can see these.' }),
    current.snap.finalizedSlot != null
      ? el('button', { class: 'btn ghost', text: '↩︎ Unlock the chosen time', onClick: async () => { await api.patchEvent(current.id, { finalizedSlot: null }); backdrop.remove(); reloadSnapshot(true); } })
      : (focusSlot != null ? el('button', { class: 'btn', text: `🔒 Lock best time (${slotFullLabel(current.snap, focusSlot)})`, onClick: async () => { await api.patchEvent(current.id, { finalizedSlot: focusSlot }); backdrop.remove(); reloadSnapshot(true); } }) : null),
    el('p', { class: 'muted small', text: 'Tip: click any cell in the group heatmap to lock that exact slot.' }),
    el('button', { class: 'btn ghost', text: 'Close', onClick: () => backdrop.remove() }));
  backdrop.append(m); document.body.append(backdrop);
}

// ---- share / ICS ----------------------------------------------------------
async function shareLink() {
  const url = location.href;
  if (navigator.share) { try { await navigator.share({ title: current.snap.title, url }); return; } catch { /* fall through */ } }
  try { await navigator.clipboard.writeText(url); toast('Link copied to clipboard 🔗'); }
  catch { prompt('Copy this link:', url); }
}

function downloadICS(snap, slot) {
  const { minute } = decodeSlot(snap, slot);
  const iso = slotDateISO(snap, slot);
  let dtStart;
  if (iso) {
    dtStart = new Date(`${iso}T00:00:00`); dtStart.setMinutes(minute);
  } else {
    // days-of-week: next matching weekday
    const target = Number(snap.dates[decodeSlot(snap, slot).dateIndex]);
    dtStart = new Date(); dtStart.setHours(0, 0, 0, 0);
    while (dtStart.getDay() !== target) dtStart.setDate(dtStart.getDate() + 1);
    dtStart.setMinutes(minute);
  }
  const dtEnd = new Date(dtStart.getTime() + snap.slotMinutes * 60000);
  const topLoc = [...snap.locations].sort((a, b) => b.votes.length - a.votes.length)[0];
  const topRoute = [...snap.routes].sort((a, b) => b.votes.length - a.votes.length)[0];
  const fmt = (d) => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
  const desc = [snap.description, topRoute ? `Route: ${topRoute.name}${topRoute.url ? ' ' + topRoute.url : ''}` : '', `Organized via when2run: ${location.href}`].filter(Boolean).join('\\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//when2run//EN', 'BEGIN:VEVENT',
    `UID:${snap.id}-${slot}@when2run`, `DTSTART:${fmt(dtStart)}`, `DTEND:${fmt(dtEnd)}`,
    `SUMMARY:🏃 ${escICS(snap.title)}`, topLoc ? `LOCATION:${escICS(topLoc.address || topLoc.name)}` : '',
    `DESCRIPTION:${escICS(desc)}`, 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${snap.title.replace(/\W+/g, '-')}.ics` });
  document.body.append(a); a.click(); a.remove();
}
function pad(n) { return String(n).padStart(2, '0'); }
function escICS(s) { return String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }

function flashSaved() {
  const t = $('#saved-tag'); if (!t) return;
  t.textContent = '✓ saved'; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1500);
}

// ---- polling --------------------------------------------------------------
let pollTimer = null;
function startPolling(id) {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (document.hidden) return;
    if (current.grids.edit?.painting) return; // don't clobber mid-paint
    try {
      const { version } = await api.getVersion(id);
      if (version !== current.version) reloadSnapshot(false);
    } catch { /* ignore transient */ }
  }, 4000);
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

async function reloadSnapshot(force) {
  try {
    const snap = await api.getEvent(current.id);
    current.snap = snap; current.version = snap.version;
    paintEvent();
  } catch { if (force) toast('Refresh failed', 'error'); }
}

// ---- chrome ---------------------------------------------------------------
function topbar() {
  return el('nav', { class: 'topbar' },
    el('a', { class: 'brand', href: '/', 'data-link': true },
      el('span', { class: 'brand-mark', text: '🏃' }),
      el('span', { class: 'brand-name', html: 'when2<span class="grad">run</span>' })),
    el('div', { class: 'topbar-actions' },
      el('a', { class: 'btn ghost sm', href: '/', 'data-link': true, text: '+ New run' }),
      el('button', { class: 'icon-btn theme-toggle', title: 'Toggle theme', text: '◐', onClick: toggleTheme })));
}
function footer() {
  return el('footer', { class: 'site-footer' },
    el('span', { html: 'Built for runners · <a href="/" data-link>when2run</a>' }),
    el('span', { class: 'muted', text: 'No account needed · your data lives in this run’s link' }));
}

// ---- boot -----------------------------------------------------------------
initTheme();
route();
