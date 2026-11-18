// Small fetch wrapper that adds the login token and turns errors into messages.

// Backend address, set at build time (VITE_API_URL). Empty = same origin (local dev uses Vite's proxy).
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
/** Full URL for a file the backend serves, e.g. "/uploads/abc" -> "https://api.example.com/uploads/abc". */
export const fileUrl = path => (path && path.startsWith('/') ? API_URL + path : path);
const OFFLINE = 'Cannot reach the server. If it was asleep, wait a few seconds and try again.';

export const STATUSES = ['Open', 'In Progress', 'Fixed', 'Ready for Retest', 'Reopened', 'Closed', 'Not a Bug'];
export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
// Developers can't close or reopen: the tester verifies the fix (same as the backend's src/constants.js)
export const DEV_STATUSES = ['Open', 'In Progress', 'Fixed', 'Ready for Retest', 'Not a Bug'];
export const SUPER_ADMIN = 'Super Admin';
// The super admin approves sign-ups, (de)activates accounts and is the only one who manages project teams.
export const isAdmin = user => user?.role === SUPER_ADMIN;
// Testers and the super admin have full access to bugs (report, edit all fields, close, reopen, import).
export const isTester = user => user?.role === 'Tester' || isAdmin(user);
// Bugs are never assigned to the super admin, so they are left out of every assignee list.
export const isAssignable = user => !isAdmin(user);

const TOKEN_KEY = 'bugtracker.token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = t => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

// Count of requests in flight, so the page can show a loading bar while the API is busy.
let pending = 0;
const listeners = new Set();
export const subscribePending = fn => { listeners.add(fn); fn(pending); return () => listeners.delete(fn); };
async function track(promise, silent) {
  if (silent) return promise;
  pending++; listeners.forEach(fn => fn(pending));
  try { return await promise; } finally { pending--; listeners.forEach(fn => fn(pending)); }
}

// silent: true skips the loading bar (used for background refreshes)
export function api(path, { method = 'GET', body, form, silent } = {}) {
  return track(request(path, { method, body, form }), silent);
}
async function request(path, { method, body, form }) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(API_URL + '/api' + path, { method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch {
    throw new Error(OFFLINE);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const importCsv = (projectId, file) => track((async () => {
  const text = await file.text();
  const res = await fetch(`${API_URL}/api/import?project=${projectId}`, {
    method: 'POST', body: text, headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'text/csv' },
  }).catch(() => { throw new Error(OFFLINE); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Import failed.');
  return data;
})());

export const downloadCsv = project => track((async () => {
  const res = await fetch(`${API_URL}/api/export.csv?project=${project.id}`, { headers: { Authorization: 'Bearer ' + getToken() } })
    .catch(() => { throw new Error(OFFLINE); });
  if (!res.ok) throw new Error('Export failed.');
  const url = URL.createObjectURL(await res.blob());
  const safe = project.name.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'bugs';
  const a = Object.assign(document.createElement('a'), { href: url, download: `${safe}-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
})());

export const STATUS_VAR = {
  'Open': '--s-open', 'In Progress': '--s-prog', 'Fixed': '--s-fixed', 'Ready for Retest': '--s-retest',
  'Reopened': '--s-reopen', 'Closed': '--s-closed', 'Not a Bug': '--s-reject',
};
export const PRIORITY_VAR = { Critical: '--p-crit', High: '--p-high', Medium: '--p-med', Low: '--p-low' };

export const fmtDate = s => {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  return isNaN(d) ? s : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtTime = s => {
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? s : d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------- desktop notifications (Web Push) ----------
// The person's choice is remembered per browser; the push subscription itself is dropped on sign-out
// (so a shared PC doesn't get the previous person's notifications) and restored on the next sign-in.
const DESKTOP_KEY = 'bugtracker.desktop';
const getPref = () => { try { return localStorage.getItem(DESKTOP_KEY); } catch { return null; } };
const setPref = v => { try { localStorage.setItem(DESKTOP_KEY, v); } catch { /* private mode */ } };
export const desktopWanted = () => getPref() === 'on';

export const desktopSupported = () =>
  typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

const swRegistration = () => navigator.serviceWorker.register('/sw.js');
const currentSubscription = async () => (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();

function base64UrlToBytes(b64) {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

/** 'unsupported' | 'blocked' | 'on' (push active) | 'local' (pop-ups only while a tab is open) | 'off' */
export async function desktopStatus() {
  if (!desktopSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted' || !desktopWanted()) return 'off';
  try { return (await currentSubscription()) ? 'on' : 'local'; } catch { return 'local'; }
}

/** Subscribes this browser and tells the backend. Returns false when the server has push turned off. */
async function subscribeThisBrowser({ silent } = {}) {
  const { enabled, publicKey } = await api('/push/public-key', { silent });
  if (!enabled) return false;
  const reg = await swRegistration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() }, silent });
  return true;
}

/** Turned on from a click: asks for permission, then subscribes. Returns the new status. */
export async function enableDesktop() {
  if (!desktopSupported()) throw new Error('This browser does not support desktop notifications.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied'
    ? 'Notifications are blocked for this site. Allow them from the icon left of the address bar, then try again.'
    : 'Notifications were not allowed.');
  setPref('on');
  try { await subscribeThisBrowser(); } catch { /* falls back to pop-ups while a tab is open */ }
  return desktopStatus();
}

/** userChoice: the person turned it off (remembered). Otherwise (sign-out) only this session's subscription goes. */
export async function disableDesktop({ userChoice = false } = {}) {
  if (userChoice) setPref('off');
  try {
    if (!desktopSupported()) return;
    const sub = await currentSubscription();
    if (!sub) return;
    if (getToken()) await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint }, silent: true }).catch(() => {});
    await sub.unsubscribe();
  } catch { /* nothing to undo */ }
}

/** After sign-in: if this browser had notifications on, subscribe again for whoever is signed in now. */
export async function resyncDesktop() {
  try {
    if (!desktopSupported() || Notification.permission !== 'granted' || !desktopWanted()) return;
    await subscribeThisBrowser({ silent: true });
  } catch { /* best effort */ }
}

/** Shows a pop-up from the page itself (used while a tab is open and push is not available). */
export async function showLocalNotification({ title, body, url, tag }) {
  if (!desktopSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await swRegistration();
    await reg.showNotification(title, { body, tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url } });
  } catch { /* ignore */ }
}
