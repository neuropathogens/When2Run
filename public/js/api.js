// Thin API client with per-participant/admin token handling (localStorage).

const LS = {
  part: (eid) => `w2r:part:${eid}`,      // { id, token, name }
  admin: (eid) => `w2r:admin:${eid}`,    // adminToken
  theme: 'w2r:theme',
  strava: 'w2r:strava',                  // access token (session)
};

export const identity = {
  get(eid) { try { return JSON.parse(localStorage.getItem(LS.part(eid))); } catch { return null; } },
  set(eid, v) { localStorage.setItem(LS.part(eid), JSON.stringify(v)); },
  clear(eid) { localStorage.removeItem(LS.part(eid)); },
  admin(eid) { return localStorage.getItem(LS.admin(eid)); },
  setAdmin(eid, t) { localStorage.setItem(LS.admin(eid), t); },
};

async function req(method, url, body, eid) {
  const headers = { 'Content-Type': 'application/json' };
  if (eid) {
    const id = identity.get(eid);
    if (id?.token) headers['x-participant-token'] = id.token;
    const at = identity.admin(eid);
    if (at) headers['x-admin-token'] = at;
  }
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
  return data;
}

export const api = {
  createEvent: (payload) => req('POST', '/api/events', payload),
  getEvent: (id) => req('GET', `/api/events/${id}`),
  getVersion: (id) => req('GET', `/api/events/${id}/version`),
  patchEvent: (id, payload) => req('PATCH', `/api/events/${id}`, payload, id),

  join: (id, payload) => req('POST', `/api/events/${id}/participants`, payload),
  setAvailability: (id, pid, slots) => req('PUT', `/api/events/${id}/participants/${pid}/availability`, { slots }, id),
  setPrefs: (id, pid, prefs) => req('PUT', `/api/events/${id}/participants/${pid}/prefs`, prefs, id),
  removeParticipant: (id, pid) => req('DELETE', `/api/events/${id}/participants/${pid}`, null, id),

  addLocation: (id, payload) => req('POST', `/api/events/${id}/locations`, payload, id),
  voteLocation: (id, lid) => req('POST', `/api/events/${id}/locations/${lid}/vote`, {}, id),
  delLocation: (id, lid) => req('DELETE', `/api/events/${id}/locations/${lid}`, null, id),

  addRoute: (id, payload) => req('POST', `/api/events/${id}/routes`, payload, id),
  voteRoute: (id, rid) => req('POST', `/api/events/${id}/routes/${rid}/vote`, {}, id),
  delRoute: (id, rid) => req('DELETE', `/api/events/${id}/routes/${rid}`, null, id),

  addComment: (id, body) => req('POST', `/api/events/${id}/comments`, { body }, id),

  geocode: (q) => req('GET', `/api/geocode?q=${encodeURIComponent(q)}`),
  weather: (lat, lng, date) => req('GET', `/api/weather?lat=${lat}&lng=${lng}${date ? `&date=${date}` : ''}`),

  stravaStatus: () => req('GET', '/api/strava/status'),
  stravaRoutes: async (token) => {
    const res = await fetch('/api/strava/routes', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('strava_error');
    return res.json();
  },
};

export { LS };
