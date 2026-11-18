import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api, getToken, setToken, downloadCsv, importCsv, STATUSES, DEV_STATUSES, PRIORITIES, STATUS_VAR, PRIORITY_VAR, fmtDate, fmtTime, today,
  isTester, isAdmin, isAssignable, fileUrl,
  desktopStatus, enableDesktop, disableDesktop, resyncDesktop, showLocalNotification,
} from './api.js';
import AdminScreen from './AdminScreen.jsx';
import { AdminBadge, BusyBtn, Loader, Spinner, TopProgress, TopRight, useSlowHint } from './ui.jsx';

// Roles people can sign up for. The super admin approves every new account.
const ROLE_INFO = {
  Tester: ['Tester (QA)', 'Report bugs, import sheets, edit bug details, and verify fixes: close or reopen bugs.'],
  Developer: ['Developer', 'Work on bugs: move them to In Progress, Fixed, Ready for Retest or Not a Bug, comment and add notes.'],
};

// ---------- small pieces ----------
const StatusPill = ({ status }) => (
  <span className="status" style={{ '--c': `var(${STATUS_VAR[status] || '--muted'})` }}>
    <span className="dot" />{status}
  </span>
);
const Priority = ({ priority }) => (
  <span className={'pri' + (priority ? '' : ' unset')}><span className="bar" style={{ '--c': `var(${PRIORITY_VAR[priority] || '--line'})` }} />{priority || 'Not set'}</span>
);

// toast('Saved') shows a green success message; toast(msg, 'error') a red one.
function useToast() {
  const [t, setT] = useState(null);
  const timer = useRef();
  const show = useCallback((msg, kind = 'success') => {
    setT({ msg, kind, id: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), kind === 'error' ? 4500 : 3000);
  }, []);
  return [t, show];
}

// The toast exists only while it has a message (a new one per toast, keyed by id), so the page can
// never be left with an empty box. Shown as a popover so it sits above open dialogs (the browser's top layer).
function Toast({ toast }) {
  return toast ? <ToastBox key={toast.id} toast={toast} /> : null;
}

function ToastBox({ toast }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    if (!el.showPopover) return; // older browsers: shown as a normal fixed box
    el.setAttribute('popover', 'manual');
    try { el.showPopover(); } catch { /* already open */ }
    return () => { try { el.hidePopover(); } catch { /* already closed */ } };
  }, []);
  return (
    <div ref={ref} className={'toast ' + toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <span className="t-icon" aria-hidden="true">{toast.kind === 'error' ? '!' : '✓'}</span>{toast.msg}
    </div>
  );
}

// canClose(): return false to keep the dialog open (e.g. to protect unsaved typing)
function Modal({ open, onClose, className, children, labelledBy, canClose = () => true }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) { d.showModal(); d.querySelector('[data-autofocus]')?.focus(); }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={className} aria-labelledby={labelledBy}
      onCancel={e => { if (!canClose()) e.preventDefault(); }}
      onClose={onClose} onClick={e => { if (e.target === ref.current && canClose()) onClose(); }}>
      {open && children}
    </dialog>
  );
}

// ---------- login / register ----------
function AuthScreen({ onAuthed, toast }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', username: '', password: '', role: 'Tester' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [requested, setRequested] = useState(null); // the sign-up request just sent: { name, role }
  const slow = useSlowHint(busy);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const switchMode = to => { setMode(to); setErr(''); setRequested(null); };

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const data = await api(`/auth/${mode}`, { method: 'POST', body: f });
      if (data.pending) {
        // New accounts wait for the super admin's approval: no sign-in yet
        setRequested(data.user);
        setMode('login'); setF(prev => ({ ...prev, password: '' })); setBusy(false);
        toast('Request sent. The admin will review your account.');
        return;
      }
      setToken(data.token);
      onAuthed(data.user);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit} aria-busy={busy || undefined}>
        <h1>Bug Log</h1>
        {requested && (
          <div className="request-sent" role="status">
            <b>Request sent to the admin</b>
            <span>Thanks, {requested.name}. Your {requested.role === 'Tester' ? 'Tester (QA)' : requested.role} account is waiting for approval.
              You can sign in here as soon as the admin approves it.</span>
          </div>
        )}
        <p className="muted">{mode === 'login'
          ? 'Sign in to report and track bugs.'
          : 'Request an account as a tester or developer. The admin approves new accounts before you can sign in.'}</p>
        {mode === 'register' && (
          <>
            <fieldset className="roles">
              <legend>What is your role?</legend>
              {Object.entries(ROLE_INFO).map(([role, [label, info]]) => (
                <label key={role} className="role-card">
                  <input type="radio" name="role" value={role} checked={f.role === role} onChange={set('role')} />
                  <span><b>{label}</b><small>{info}</small></span>
                </label>
              ))}
            </fieldset>
            <label className="f">Full name<input id="r-name" value={f.name} onChange={set('name')} required /></label>
          </>
        )}
        <label className="f">Username<input id="a-user" value={f.username} onChange={set('username')} autoComplete="username" required /></label>
        <label className="f">Password
          <span className="pw">
            <input id="a-pass" type={showPw ? 'text' : 'password'} value={f.password} onChange={set('password')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 6 : undefined} required />
            <button type="button" className="pw-toggle" onClick={() => setShowPw(s => !s)} aria-pressed={showPw}>{showPw ? 'Hide' : 'Show'}</button>
          </span>
          {mode === 'register' && <span className="hint">At least 6 characters</span>}
        </label>
        {err && <p className="err">{err}</p>}
        <BusyBtn className="btn primary" busy={busy} busyText={mode === 'login' ? 'Signing in…' : 'Sending request…'}>
          {mode === 'login' ? 'Sign in' : 'Request account'}</BusyBtn>
        {slow && <p className="hint slow">The server is waking up. This can take up to a minute the first time.</p>}
        <button type="button" className="link-btn" disabled={busy} onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New here? Request an account' : 'Already approved? Sign in'}
        </button>
      </form>
    </div>
  );
}

// ---------- bug form ----------
const EMPTY = {
  panel: '', module: '', description: '', steps: '', expected: '', actual: '', status: 'Open', priority: 'Medium',
  assignee_id: '', date_reported: '', link: '', screenshot: '', notes: '',
};

function BugForm({ bug, project, users, modules, panels, onSaved, onCancel, dirtyRef }) {
  const [initial] = useState(() => bug ? { ...EMPTY, ...bug, assignee_id: bug.assignee_id ?? '' } : { ...EMPTY, date_reported: today() });
  const [f, setF] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const set = k => e => setF(prev => ({ ...prev, [k]: e.target.value }));
  if (dirtyRef) dirtyRef.current = Object.keys(EMPTY).some(k => String(f[k] ?? '') !== String(initial[k] ?? ''));

  const [uploading, setUploading] = useState(false);
  async function uploadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true); setErr('');
    try {
      const form = new FormData();
      form.append('file', file);
      const { url } = await api('/upload', { method: 'POST', form });
      setF(prev => ({ ...prev, screenshot: url }));
    } catch (e) { setErr(e.message); }
    setUploading(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (!f.module.trim() || !f.description.trim()) { setErr('Module and Description are required.'); return; }
    if (f.date_reported && f.date_reported > today()) { setErr('Date reported cannot be in the future.'); return; }
    setBusy(true); setErr('');
    try {
      const body = { ...f, assignee_id: f.assignee_id || null, project_id: project.id };
      const { bug: saved } = bug
        ? await api(`/bugs/${bug.id}`, { method: 'PUT', body })
        : await api('/bugs', { method: 'POST', body });
      onSaved(saved, !bug);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  }

  // Assignees: active developers and testers on the team (plus whoever is assigned now, even if since deactivated)
  const pickable = users.filter(u => isAssignable(u) && (u.status !== 'inactive' || String(u.id) === String(initial.assignee_id)));
  const developers = pickable.filter(u => u.role === 'Developer');
  const others = pickable.filter(u => u.role === 'Tester');

  return (
    <form onSubmit={submit} noValidate
      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.requestSubmit(); } }}
      onPaste={e => { const file = e.clipboardData?.files?.[0]; if (file) { e.preventDefault(); uploadFile(file); } }}>
      <div className="dlg-head"><h2 id="form-title">{bug ? `Edit ${bug.key}` : 'Report a bug'}</h2>
        <button type="button" className="x" onClick={onCancel} aria-label="Close">×</button></div>
      <div className="dlg-body">
        <div className="grid3">
          <label className="f">Panel
            <input id="i-panel" list="panels" value={f.panel} onChange={set('panel')} placeholder="e.g. Agent panel, Admin panel" />
            <datalist id="panels">{panels.map(p => <option key={p} value={p} />)}</datalist>
          </label>
          <label className="f"><span>Module <span className="req">*</span></span>
            <input id="i-module" list="modules" value={f.module} onChange={set('module')} placeholder="e.g. Login, Checkout" data-autofocus />
            <datalist id="modules">{modules.map(m => <option key={m} value={m} />)}</datalist>
          </label>
          <label className="f">Date reported<input id="i-date" type="date" value={f.date_reported} max={today()} onChange={set('date_reported')} /></label>
        </div>
        <label className="f"><span>Description <span className="req">*</span></span>
          <textarea id="i-desc" rows={2} value={f.description} onChange={set('description')} placeholder="Short summary of the problem" /></label>
        <label className="f">Steps to reproduce
          <textarea id="i-steps" rows={4} value={f.steps} onChange={set('steps')} placeholder={'1. Open the login page\n2. Enter a valid email\n3. Click Sign in'} /></label>
        <div className="grid2">
          <label className="f">Expected result<textarea id="i-exp" rows={3} value={f.expected} onChange={set('expected')} /></label>
          <label className="f">Actual result<textarea id="i-act" rows={3} value={f.actual} onChange={set('actual')} /></label>
        </div>
        <div className="grid3">
          <label className="f">Status<select id="i-status" value={f.status} onChange={set('status')}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
          <label className="f">Priority<select id="i-pri" value={f.priority} onChange={set('priority')}><option value="">Not set</option>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></label>
          <label className="f">Assignee
            <select id="i-asg" value={f.assignee_id} onChange={set('assignee_id')}>
              <option value="">Unassigned</option>
              {developers.length > 0 && <optgroup label="Developers">{developers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>}
              {others.length > 0 && <optgroup label="Testers">{others.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>}
            </select>
          </label>
        </div>
        <label className="f">Screenshot / link<input id="i-link" type="url" value={f.link} onChange={set('link')} placeholder="https://… (Drive, video, Jira, etc.)" /></label>
        <div className="f">
          <span>Screenshot image</span>
          {uploading
            ? <div className="drop uploading" role="status"><Spinner size="lg" /><span>Uploading screenshot…</span></div>
            : f.screenshot
            ? <div className="thumb"><img src={fileUrl(f.screenshot)} alt="Screenshot" />
                <button type="button" onClick={() => setF(prev => ({ ...prev, screenshot: '' }))}>Remove</button></div>
            : <label className={'drop' + (dragging ? ' over' : '')}
                onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); uploadFile(e.dataTransfer.files[0]); }}>
                <input id="i-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={e => uploadFile(e.target.files[0])} />
                <span className="drop-icon" aria-hidden="true">⬆</span>
                <span><b>Choose an image</b>, drag it here, or paste it with Ctrl+V</span>
                <span className="hint">PNG, JPG, GIF or WebP, up to 5 MB</span>
              </label>}
        </div>
        <label className="f">Notes<textarea id="i-notes" rows={2} value={f.notes} onChange={set('notes')} /></label>
      </div>
      <div className="dlg-foot">
        <span className="err">{err}</span>
        <span className="hint kbd-hint">Ctrl+Enter to save</span>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <BusyBtn className="btn primary" busy={busy} disabled={uploading} busyText="Saving…">{bug ? 'Save changes' : 'Save bug'}</BusyBtn>
      </div>
    </form>
  );
}

// ---------- bug detail ----------
// The usual next moves for each status: [new status, button label, who does it]
const NEXT_STEPS = {
  'Open': [['In Progress', 'Start work', 'dev'], ['Not a Bug', 'Not a bug', 'dev']],
  'Reopened': [['In Progress', 'Start work', 'dev'], ['Not a Bug', 'Not a bug', 'dev']],
  'In Progress': [['Fixed', 'Mark fixed', 'dev'], ['Ready for Retest', 'Ready for retest', 'dev']],
  'Fixed': [['Ready for Retest', 'Ready for retest', 'dev'], ['Closed', 'Verified, close it', 'tester'], ['Reopened', 'Still broken, reopen', 'tester']],
  'Ready for Retest': [['Closed', 'Verified, close it', 'tester'], ['Reopened', 'Still broken, reopen', 'tester']],
  'Closed': [['Reopened', 'Reopen', 'tester']],
  'Not a Bug': [['Reopened', 'Reopen', 'tester']],
};
const waitingText = (status, tester) => tester
  ? (['Open', 'Reopened', 'In Progress'].includes(status) ? 'Waiting for the developer to fix this.' : 'No suggested step.')
  : (['Fixed', 'Ready for Retest'].includes(status) ? 'Waiting for the tester to retest and close it.' : 'This bug is done. A tester can reopen it if needed.');
function BugDetail({ id, me, onClose, onEdit, onChanged, onNotificationsChanged, toast }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(''); // which action is pending: 'status:<to>', 'comment', 'notes', 'delete'
  const [confirmDel, setConfirmDel] = useState(false);
  const [notes, setNotes] = useState(null); // null = not editing
  const tester = isTester(me);

  const load = useCallback(async () => {
    try {
      const d = await api(`/bugs/${id}`);
      setData(d); setStatus(d.bug.status);
    } catch (e) { setErr(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // Opening a bug counts as reading its notifications
  useEffect(() => {
    api(`/notifications/read-all?bug=${id}`, { method: 'POST', silent: true }).then(() => onNotificationsChanged?.(), () => {});
  }, [id, onNotificationsChanged]);

  async function updateStatus(target = status, which = 'status:' + target) {
    if (busy) return;
    if (target === data.bug.status && !comment.trim()) { toast('Pick a different status or type a comment first.', 'error'); return; }
    setBusy(which);
    try {
      const { bug } = await api(`/bugs/${id}/status`, { method: 'PATCH', body: { status: target, comment } });
      setComment('');
      toast(bug.status !== data.bug.status
        ? `Status updated: ${bug.key} is now ${bug.status}${comment.trim() ? ' (comment added)' : ''}`
        : `Comment added to ${bug.key}`);
      await load(); onChanged();
    } catch (e) { toast(e.message, 'error'); }
    setBusy('');
  }
  async function saveNotes() {
    setBusy('notes');
    try {
      await api(`/bugs/${id}/notes`, { method: 'PATCH', body: { notes } });
      setNotes(null); toast(`Notes saved on ${data.bug.key}`);
      await load(); onChanged();
    } catch (e) { toast(e.message, 'error'); }
    setBusy('');
  }
  async function del() {
    setBusy('delete');
    try { await api(`/bugs/${id}`, { method: 'DELETE' }); toast(`${data.bug.key} deleted successfully`); onChanged(); onClose(); }
    catch (e) { toast(e.message, 'error'); setBusy(''); }
  }

  if (err) return <div className="dlg-body"><p className="err">{err}</p></div>;
  if (!data) return <div className="dlg-body"><Loader text="Loading bug…" /></div>;
  const b = data.bug;
  const actions = (NEXT_STEPS[b.status] || []).filter(([, , who]) => who === (tester ? 'tester' : 'dev'));
  const Sec =({ title, children }) => (
    <div className="sec"><h3>{title}</h3>{children ? <p>{children}</p> : <p className="none">Not provided</p>}</div>
  );

  return (
    <>
      <div className="dlg-head"><h2 id="view-title">{b.key}</h2>
        <button className="x" onClick={onClose} aria-label="Close">×</button></div>
      <div className="dlg-body">
        <div className="statusbox">
          <div className="sb-line"><strong>Next step</strong><StatusPill status={b.status} /></div>
          {actions.length > 0
            ? <div className="quick">{actions.map(([to, label], i) => (
                <BusyBtn key={to} className={'btn' + (i === 0 ? ' primary' : '')} busy={busy === 'status:' + to} disabled={!!busy}
                  busyText="Updating…" onClick={() => updateStatus(to)}>
                  {label}<span className="to">→ {to}</span></BusyBtn>))}</div>
            : <p className="hint">{waitingText(b.status, tester)}</p>}
          <div className="sb-line grow">
            <input id="v-comment" value={comment} onChange={e => setComment(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && comment.trim()) updateStatus(b.status, 'comment'); }}
              placeholder="Comment, e.g. fixed in build 1.4.2" aria-label="Comment" />
            <BusyBtn className="btn" busy={busy === 'comment'} disabled={!!busy || !comment.trim()} busyText="Adding…"
              onClick={() => updateStatus(b.status, 'comment')}>Add comment</BusyBtn>
          </div>
          {actions.length > 0 && <span className="hint">A typed comment is saved together with the next step you click.</span>}
          <div className="sb-line">
            <label htmlFor="v-status"><strong>Change status</strong></label>
            <select id="v-status" value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.filter(s => tester || DEV_STATUSES.includes(s) || s === b.status).map(s =>
                <option key={s} disabled={!tester && !DEV_STATUSES.includes(s)}>{s}</option>)}
            </select>
            <BusyBtn className="btn primary" busy={busy === 'status-select'} disabled={!!busy || status === b.status} busyText="Updating…"
              onClick={() => updateStatus(status, 'status-select')}>Update status</BusyBtn>
          </div>
          {!tester && <span className="hint">Closing or reopening is done by the tester after they retest your fix.</span>}
        </div>

        <dl className="meta">
          <div><dt>Status</dt><dd><StatusPill status={b.status} /></dd></div>
          <div><dt>Priority</dt><dd><Priority priority={b.priority} /></dd></div>
          <div><dt>Assignee</dt><dd>{b.assignee_name || 'Unassigned'}</dd></div>
          <div><dt>Panel</dt><dd>{b.panel || '—'}</dd></div>
          <div><dt>Module</dt><dd>{b.module}</dd></div>
          <div><dt>Date reported</dt><dd>{fmtDate(b.date_reported)}</dd></div>
          <div><dt>Reported by</dt><dd>{b.reporter_name || '—'}</dd></div>
        </dl>

        <Sec title="Description">{b.description}</Sec>
        <Sec title="Steps to reproduce">{b.steps}</Sec>
        <div className="compare"><Sec title="Expected result">{b.expected}</Sec><Sec title="Actual result">{b.actual}</Sec></div>
        <div className="sec"><h3>Screenshot / link</h3>
          {!b.link && !b.screenshot && <p className="none">Not provided</p>}
          {b.link && <p><a href={b.link} target="_blank" rel="noopener noreferrer">{b.link}</a></p>}
          {b.screenshot && <a className="shot" href={fileUrl(b.screenshot)} target="_blank" rel="noopener noreferrer"><img src={fileUrl(b.screenshot)} alt="Screenshot" /></a>}
        </div>
        <div className="sec">
          <h3>Notes {notes == null && <button className="link-btn small" onClick={() => setNotes(b.notes)}>{b.notes ? 'Edit' : 'Add notes'}</button>}</h3>
          {notes != null
            ? <div className="notes-edit">
                <textarea id="v-notes" rows={4} value={notes} onChange={e => setNotes(e.target.value)} autoFocus
                  placeholder="e.g. Root cause: null check missing in cart total. Fixed in build 1.4.2" aria-label="Notes" />
                <div className="row-btns"><BusyBtn className="btn primary" busy={busy === 'notes'} disabled={!!busy} busyText="Saving…" onClick={saveNotes}>Save notes</BusyBtn>
                  <button className="btn" disabled={busy === 'notes'} onClick={() => setNotes(null)}>Cancel</button></div>
              </div>
            : b.notes ? <p>{b.notes}</p> : <p className="none">Not provided</p>}
        </div>

        <div className="sec"><h3>History</h3>
          <ul className="hist">
            {data.history.map(h => (
              <li key={h.id}>
                <time>{fmtTime(h.created_at)}</time>
                <span><b>{h.user_name || 'Someone'}</b>{h.user_role ? <span className="role"> {h.user_role}</span> : null}{' '}
                  {h.from_status && h.to_status ? <>changed status <StatusPill status={h.from_status} /> → <StatusPill status={h.to_status} /></>
                    : h.to_status ? <>reported as <StatusPill status={h.to_status} /></>
                    : 'commented'}</span>
                {h.comment && <span className="c">{h.comment}</span>}
              </li>
            ))}
          </ul>
        </div>

        <div className="row-btns">
          {tester && <button className="btn" onClick={() => onEdit(b)}>Edit all fields</button>}
          {(b.reporter_id === me.id || isAdmin(me)) && <button className="btn danger" onClick={() => setConfirmDel(true)}>Delete</button>}
        </div>
        {confirmDel && (
          <div className="confirm">
            <span>Delete {b.key} for everyone? This can't be undone.</span>
            <BusyBtn className="btn danger" busy={busy === 'delete'} busyText="Deleting…" onClick={del}>Yes, delete</BusyBtn>
            <button className="btn" disabled={busy === 'delete'} onClick={() => setConfirmDel(false)}>Keep</button>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- team (project members) ----------
// Everyone can see the team; only the super admin adds or removes people.
function TeamPanel({ project, me, members, onChanged, onClose, toast }) {
  const canManage = isAdmin(me);
  const [everyone, setEveryone] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [loadingPeople, setLoadingPeople] = useState(canManage);

  useEffect(() => {
    if (canManage) api('/users').then(setEveryone).catch(() => {}).finally(() => setLoadingPeople(false));
  }, [canManage]);
  const memberIds = new Set(members.map(m => m.id));
  const candidates = everyone.filter(u => !memberIds.has(u.id));

  async function add() {
    if (!pick) return;
    setBusy(true);
    try {
      const r = await api(`/projects/${project.id}/members`, { method: 'POST', body: { user_id: Number(pick) } });
      toast(`${r.added.name} added to ${project.name}. They can see this project now.`);
      setPick(''); onChanged();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  }
  async function remove(m) {
    setBusy(true);
    try {
      const r = await api(`/projects/${project.id}/members/${m.id}`, { method: 'DELETE' });
      toast(`${m.name} removed from ${project.name}` + (r.unassigned ? `. ${r.unassigned} bug${r.unassigned === 1 ? '' : 's'} assigned to them are now unassigned.` : '.'));
      setConfirmId(null); onChanged();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  }

  return (
    <>
      <div className="dlg-head"><h2 id="team-title">Team · {project.name}</h2>
        <button className="x" onClick={onClose} aria-label="Close">×</button></div>
      <div className="dlg-body">
        <p className="hint">Only the people listed here (and the admin) can see this project and its bugs.
          {canManage ? ' Add a developer or tester to give them access.' : ' Ask the admin to add or remove people.'}</p>
        {canManage && (
          <div className="team-add">
            <select id="t-pick" value={pick} onChange={e => setPick(e.target.value)} aria-label="Person to add" disabled={loadingPeople}>
              <option value="">{loadingPeople ? 'Loading people…' : candidates.length ? 'Choose a person to add…' : 'Every active tester and developer is already here'}</option>
              {['Developer', 'Tester'].map(role => {
                const list = candidates.filter(u => u.role === role);
                return list.length > 0 && <optgroup key={role} label={role + 's'}>{list.map(u => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}</optgroup>;
              })}
            </select>
            <BusyBtn className="btn primary" busy={busy && !confirmId} disabled={!pick || busy} busyText="Adding…" onClick={add}>Add to project</BusyBtn>
          </div>
        )}
        {canManage && <p className="hint">Not in the list? They need to request an account, and you approve it in the <a href="#admin">admin panel</a>.</p>}
        {members.length === 0 && <p className="hint">No one is on this project yet.</p>}
        <ul className="team">
          {members.map(m => (
            <li key={m.id}>
              <span className="t-who"><b>{m.name}</b>{m.id === me.id && <span className="you"> (you)</span>}
                <small>{m.username} · {m.role}{m.status && m.status !== 'active' ? ` · account ${m.status}` : ''}{m.added_by_name ? ` · added by ${m.added_by_name}` : ''}</small></span>
              {canManage && (confirmId === m.id
                ? <span className="t-confirm">Remove? <BusyBtn className="btn danger" busy={busy} busyText="Removing…" onClick={() => remove(m)}>Yes, remove</BusyBtn>
                    <button className="btn" disabled={busy} onClick={() => setConfirmId(null)}>Keep</button></span>
                : <button className="btn ghost danger" onClick={() => setConfirmId(m.id)}>Remove</button>)}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ---------- project picker ----------
function ProjectsScreen({ me, onOpen, onLogout, signingOut, unread, toast }) {
  const [projects, setProjects] = useState(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const slow = useSlowHint(projects === null && !err);
  // Every word typed must appear in the project's name or description (any order, any case)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (projects || []).filter(p => {
    const text = `${p.name} ${p.description || ''}`.toLowerCase();
    return words.every(w => text.includes(w));
  });

  const load = useCallback(() => {
    setRefreshing(true);
    return api('/projects').then(p => { setProjects(p); setErr(''); }).catch(e => setErr(e.message)).finally(() => setRefreshing(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    setErr(''); setCreating(true);
    try {
      const { project } = await api('/projects', { method: 'POST', body: { name, description: desc } });
      toast(`Project "${project.name}" created successfully. Click it to open.`);
      setAdding(false); setName(''); setDesc('');
      load();
    } catch (e2) { setErr(e2.message); }
    setCreating(false);
  }

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="brand"><h1>Bug Log</h1><span className="sub">{me.name} · {me.role}</span></div>
          <TopRight unread={unread} onLogout={onLogout} signingOut={signingOut} />
        </div>
      </header>
      <main className="wrap projects">
        <div className="projects-head">
          <h2>Select a project</h2>
          {!adding && isAdmin(me) && <button className="btn primary" onClick={() => setAdding(true)}>+ New project</button>}
        </div>
        {adding && (
          <form className="new-project" onSubmit={create}>
            <label className="f">Project name<input id="p-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. ROA - Mentorship Web" autoFocus /></label>
            <label className="f">Description<input id="p-desc" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional" /></label>
            <div className="row-btns"><BusyBtn className="btn primary" busy={creating} disabled={!name.trim()} busyText="Creating…">Create</BusyBtn>
              <button type="button" className="btn" disabled={creating} onClick={() => { setAdding(false); setErr(''); }}>Cancel</button></div>
          </form>
        )}
        {err && <div className="notice">{err}</div>}
        {projects === null && !err && (
          <div className="project-grid" aria-busy="true">
            {[0, 1, 2].map(i => <div key={i} className="project-card skeleton"><span /><span /><span /></div>)}
            <span className="sr-only" role="status">Loading projects…</span>
          </div>
        )}
        {slow && <p className="hint slow">The server is waking up. This can take up to a minute the first time.</p>}
        {projects && projects.length > 0 && (
          <div className="project-search">
            <input id="p-search" type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search projects by name or description…" aria-label="Search projects" autoComplete="off"
              onKeyDown={e => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'Enter' && query && shown.length === 1) onOpen(shown[0].id);
              }} />
            {query && <span className="hint" role="status">{shown.length} of {projects.length} project{projects.length === 1 ? '' : 's'}
              {shown.length === 1 ? ' · press Enter to open' : ''}</span>}
          </div>
        )}
        {projects && projects.length > 0 && shown.length === 0 && (
          <div className="empty list">
            <h2>No projects match “{query}”</h2>
            <p>Try another word, or clear the search.</p>
            <button className="btn" onClick={() => setQuery('')}>Clear search</button>
          </div>
        )}
        {projects && projects.length === 0 && !adding && (
          <div className="empty list">
            {isAdmin(me)
              ? <><h2>No projects yet</h2><p>Create a project, then add testers and developers to it from Team.</p></>
              : <><h2>You haven't been added to a project yet</h2><p>Ask the admin to add <b>{me.username}</b> to a project. It will show up here right after.</p>
                  <BusyBtn className="btn" busy={refreshing} busyText="Checking…" onClick={load}>Check again</BusyBtn></>}
          </div>
        )}
        <div className="project-grid">
          {shown.map(p => (
            <button key={p.id} className="project-card" onClick={() => onOpen(p.id)}>
              <span className="p-name">{p.name}</span>
              {p.description && <span className="p-desc">{p.description}</span>}
              <span className="p-stats">
                <span><b>{p.total}</b> bugs</span>
                <span style={{ '--c': 'var(--s-open)' }}><span className="dot" /> <b>{p.active || 0}</b> open</span>
                <span style={{ '--c': 'var(--s-retest)' }}><span className="dot" /> <b>{p.to_verify || 0}</b> to verify</span>
                {me.role === 'Developer' && <span style={{ '--c': 'var(--accent)' }}><span className="dot" /> <b>{p.mine || 0}</b> assigned to you</span>}
              </span>
              <span className="p-date">{p.members} member{p.members === 1 ? '' : 's'}</span>
              <span className="p-date">{p.last_activity ? 'Updated ' + fmtTime(p.last_activity) : 'No bugs yet'}</span>
            </button>
          ))}
        </div>
      </main>
    </>
  );
}

// ---------- notifications ----------
const NOTIF_POLL_MS = 20000;

const relTime = s => {
  const sec = Math.round((Date.now() - new Date(s)) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)} d ago`;
  return fmtTime(s);
};

// "Tom Tester changed BUG-012 from Open to In Progress"
function NotifText({ n }) {
  if (n.type === 'signup_request') {
    return <span className="n-text"><b>{n.actor_name}</b>{n.actor_role && <span className="role"> ({n.actor_role})</span>} requested an account</span>;
  }
  if (n.type === 'added_to_project') {
    return <span className="n-text"><b>{n.actor_name}</b>{n.actor_role && <span className="role"> ({n.actor_role})</span>} added you to the project <b>{n.project_name || 'a project'}</b></span>;
  }
  const key = <b className="mono">{n.bug_key}</b>;
  const move = n.from_status && n.to_status
    ? <> from <StatusPill status={n.from_status} /> to <StatusPill status={n.to_status} /></> : null;
  const what = {
    reported: <>reported {key}{n.to_status ? <> as <StatusPill status={n.to_status} /></> : null}</>,
    status: <>changed {key}{move}</>,
    comment: <>commented on {key}</>,
    edited: <>edited {key}{move}</>,
    notes: <>updated the notes on {key}</>,
  }[n.type] || <>updated {key}</>;
  return <span className="n-text"><b>{n.actor_name}</b>{n.actor_role && <span className="role"> ({n.actor_role})</span>} {what}</span>;
}

// Plain-text version of a notification, for desktop pop-ups shown by the page itself
function notifPlain(n) {
  const who = n.actor_name || 'Someone';
  if (n.type === 'signup_request')
    return { title: `${who} wants to join as ${n.actor_role || 'a user'}`, body: 'Approve or reject the request in the admin panel.', url: '/#admin' };
  if (n.type === 'added_to_project')
    return { title: `${who} added you to ${n.project_name || 'a project'}`, body: 'Open Bug Log to see its bugs.', url: `/#project-${n.project_id}` };
  const k = n.bug_key;
  const title = {
    reported: `${who} reported ${k}`,
    status: `${who} changed ${k} to ${n.to_status}`,
    comment: `${who} commented on ${k}`,
    edited: n.to_status ? `${who} edited ${k} (now ${n.to_status})` : `${who} edited ${k}`,
    notes: `${who} updated the notes on ${k}`,
  }[n.type] || `${who} updated ${k}`;
  const body = [n.bug_title, n.type === 'status' && n.from_status ? `${n.from_status} → ${n.to_status}` : '',
    n.comment ? `“${n.comment}”` : '', n.project_name].filter(Boolean).join('\n');
  return { title, body, url: `/#project-${n.project_id}/bug-${n.bug_id}` };
}

const DESKTOP_TEXT = {
  off: ['Get Windows desktop notifications', 'A pop-up appears in the corner of your screen for each new notification, even when Bug Log is closed.'],
  on: ['Desktop notifications are on', 'You’ll get a pop-up for each new notification, even when Bug Log is closed (while Chrome or Edge is running).'],
  local: ['Desktop notifications are on while Bug Log is open', 'Push isn’t available right now, so pop-ups only appear while a Bug Log tab is open.'],
  blocked: ['Desktop notifications are blocked', 'Click the icon left of the address bar, set Notifications to Allow, then reload the page.'],
};

// On/off switch for desktop pop-ups on this browser
function DesktopCard({ toast }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { desktopStatus().then(setStatus); }, []);
  if (!status || status === 'unsupported') return null;

  async function turnOn() {
    setBusy(true);
    try {
      const s = await enableDesktop();
      setStatus(s);
      toast(s === 'on' ? 'Desktop notifications are on.' : 'Desktop notifications are on while a Bug Log tab is open.');
    } catch (e) { setStatus(await desktopStatus()); toast(e.message, 'error'); }
    setBusy(false);
  }
  async function turnOff() {
    setBusy(true);
    await disableDesktop({ userChoice: true });
    setStatus(await desktopStatus());
    toast('Desktop notifications are off for this browser.');
    setBusy(false);
  }
  const test = () => showLocalNotification({
    title: 'Bug Log', body: 'Desktop notifications are working.', url: '/#notifications', tag: 'bug-log-test',
  });

  const [title, text] = DESKTOP_TEXT[status];
  return (
    <div className={'desktop-card ' + status} role="region" aria-label="Desktop notifications">
      <svg className="dc-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
      </svg>
      <div className="dc-text"><b>{title}</b><small>{text}</small></div>
      <div className="dc-actions">
        {status === 'off' && <BusyBtn className="btn primary" busy={busy} busyText="Turning on…" onClick={turnOn}>Turn on</BusyBtn>}
        {(status === 'on' || status === 'local') && <>
          <button className="btn" onClick={test}>Send a test</button>
          <BusyBtn className="btn ghost" busy={busy} busyText="Turning off…" onClick={turnOff}>Turn off</BusyBtn>
        </>}
      </div>
    </div>
  );
}

function NotificationsScreen({ me, unread, onChanged, onLogout, signingOut, toast }) {
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(({ silent } = {}) =>
    api('/notifications' + (tab === 'unread' ? '?unread=1' : ''), { silent })
      .then(d => { setItems(d.notifications); setErr(''); })
      .catch(e => setErr(e.message)), [tab]);
  useEffect(() => { setItems(null); load(); }, [load]);
  // The bell's poll noticed something new: refresh the list quietly
  const seen = useRef(unread);
  useEffect(() => { if (unread > seen.current) load({ silent: true }); seen.current = unread; }, [unread, load]);
  useEffect(() => { document.title = (unread ? `(${unread}) ` : '') + 'Notifications · Bug Log'; }, [unread]);

  async function open(n) {
    if (!n.read) {
      setItems(list => list.map(x => (x.id === n.id ? { ...x, read: true } : x)));
      api(`/notifications/${n.id}/read`, { method: 'PATCH', silent: true }).then(onChanged, () => {});
    }
    if (n.type === 'signup_request') { location.hash = 'admin'; return; }
    if (!n.bug_id) { location.hash = `project-${n.project_id}`; return; } // project-level, e.g. "added you to …"
    if (!n.bug_title) { toast(`${n.bug_key} was deleted.`, 'error'); return; }
    location.hash = `project-${n.project_id}/bug-${n.bug_id}`;
  }
  async function markAll() {
    setMarkingAll(true);
    try {
      await api('/notifications/read-all', { method: 'POST' });
      setItems(list => (tab === 'unread' ? [] : list.map(x => ({ ...x, read: true }))));
      onChanged();
    } catch (e) { toast(e.message, 'error'); }
    setMarkingAll(false);
  }

  return (
    <>
      <header className="top">
        <div className="wrap">
          <a className="btn ghost back" href="#">← Projects</a>
          <div className="brand"><h1>Notifications</h1><span className="sub">{me.name} · {me.role}</span></div>
          <TopRight unread={unread} onLogout={onLogout} signingOut={signingOut} bellActive />
        </div>
      </header>
      <main className="wrap notifs">
        <div className="notifs-head">
          <div className="tabs" role="group" aria-label="Show">
            <button className="chip" aria-pressed={tab === 'all'} onClick={() => setTab('all')}>All</button>
            <button className="chip" aria-pressed={tab === 'unread'} onClick={() => setTab('unread')}>Unread <span className="n">{unread}</span></button>
          </div>
          <BusyBtn className="btn" busy={markingAll} disabled={!unread} busyText="Marking…" onClick={markAll}>Mark all as read</BusyBtn>
        </div>
        <DesktopCard toast={toast} />
        {err && <div className="notice">{err}</div>}
        <div className="list" aria-busy={items === null || undefined}>
          {items === null && !err && <Loader text="Loading notifications…" />}
          {items && items.length === 0 && (
            <div className="empty">
              <h2>{tab === 'unread' ? 'You’re all caught up' : 'No notifications yet'}</h2>
              <p>{isAdmin(me)
                ? 'You’ll hear when someone requests an account, and about bugs you reported.'
                : me.role === 'Developer'
                  ? 'You’ll hear when bugs assigned to you are reported, changed or commented on.'
                  : 'You’ll hear when bugs you reported or are assigned to are changed or commented on.'}</p>
            </div>
          )}
          {items && items.map(n => (
            <button key={n.id} className={'notif' + (n.read ? '' : ' unread')} onClick={() => open(n)}>
              <span className="n-dot" aria-label={n.read ? undefined : 'Unread'} />
              <span className="n-main">
                <NotifText n={n} />
                <small>{n.type === 'signup_request'
                  ? `Username ${n.subject_username || '—'} · ${n.subject_status === 'pending' ? 'waiting for your approval' : `request ${n.subject_status === 'rejected' ? 'rejected' : 'approved'}`}`
                  : !n.bug_id ? 'Open the project to see its bugs'
                  : `${n.project_name || 'Project'}${n.bug_title ? ` · ${n.bug_title}` : ' · bug deleted'}`}</small>
                {n.comment && <span className="n-comment">“{n.comment}”</span>}
              </span>
              <time dateTime={n.created_at} title={fmtTime(n.created_at)}>{relTime(n.created_at)}</time>
            </button>
          ))}
        </div>
        <p className="foot">Notifications are kept for 90 days.</p>
      </main>
    </>
  );
}

// #notifications | #admin | #project-3 | #project-3/bug-12 | (empty) = project list
const parseHash = () => {
  if (location.hash === '#notifications') return { view: 'notifications' };
  if (location.hash === '#admin') return { view: 'admin' };
  const m = location.hash.match(/^#project-(\d+)(?:\/bug-(\d+))?$/);
  return m ? { view: 'project', projectId: Number(m[1]), bugId: m[2] ? Number(m[2]) : null } : { view: 'projects' };
};

// ---------- main app ----------
export default function App() {
  const [me, setMe] = useState(null);
  const [checking, setChecking] = useState(!!getToken());
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [toastState, toast] = useToast();
  const openProject = id => { location.hash = id ? 'project-' + id : ''; };

  // Unread notification count for the bell, refreshed in the background
  const [unread, setUnread] = useState(0);
  const prevUnread = useRef(null);
  const popped = useRef({ since: 0, ids: new Set() });
  // Fallback when push isn't available: the open tab shows pop-ups for new notifications itself
  const popLocal = useCallback(async () => {
    if ((await desktopStatus()) !== 'local') return;
    const { notifications } = await api('/notifications?unread=1', { silent: true });
    const fresh = notifications
      .filter(n => new Date(n.created_at).getTime() >= popped.current.since && !popped.current.ids.has(n.id))
      .slice(0, 5).reverse();
    for (const n of fresh) {
      popped.current.ids.add(n.id);
      showLocalNotification({ ...notifPlain(n), tag: 'bug-log-' + n.id });
    }
  }, []);
  const refreshUnread = useCallback(() => {
    if (!getToken()) return;
    api('/notifications/unread-count', { silent: true }).then(d => {
      const prev = prevUnread.current;
      prevUnread.current = d.unread;
      setUnread(d.unread);
      if (prev !== null && d.unread > prev) popLocal().catch(() => {});
    }).catch(() => {});
  }, [popLocal]);
  // Super admin: number of sign-up requests waiting, shown on the header's Admin link
  const admin = isAdmin(me);
  const [adminPending, setAdminPending] = useState(0);
  const refreshAdmin = useCallback(() => {
    if (!admin || !getToken()) return;
    api('/admin/summary', { silent: true }).then(d => setAdminPending(d.counts.pending)).catch(() => {});
  }, [admin]);
  const adminBadge = { show: admin, pending: adminPending, refresh: refreshAdmin };

  useEffect(() => {
    if (!me) { setUnread(0); setAdminPending(0); prevUnread.current = null; return; }
    popped.current = { since: Date.now() - 60000, ids: new Set() };
    resyncDesktop(); // this browser's desktop notifications now go to whoever just signed in
    const refresh = () => { refreshUnread(); refreshAdmin(); };
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, NOTIF_POLL_MS);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [me, refreshUnread, refreshAdmin]);
  const [signingOut, setSigningOut] = useState(false);
  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    await disableDesktop(); // stop this browser getting the signed-out person's notifications
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null); setMe(null); setSigningOut(false); toast('Signed out successfully');
  };
  const onAuthed = user => {
    setMe(user);
    toast(`Signed in. Welcome back, ${user.name}!`);
  };
  const signedOut = useCallback(() => { setToken(null); setMe(null); toast('Your session ended. Please sign in again.', 'error'); }, [toast]);

  // A click on a desktop pop-up: the service worker asks this tab to open the bug
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = e => {
      if (e.data?.type !== 'open-url') return;
      const target = new URL(e.data.url, location.origin);
      if (target.origin === location.origin) location.hash = target.hash;
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api('/me').then(d => setMe(d.user)).catch(() => setToken(null)).finally(() => setChecking(false));
  }, []);

  return (
    <AdminBadge.Provider value={adminBadge}>
      <TopProgress />
      {checking ? <Loader full text="Checking your sign-in…" />
        : !me ? <AuthScreen onAuthed={onAuthed} toast={toast} />
        : route.view === 'notifications'
          ? <NotificationsScreen me={me} unread={unread} onChanged={refreshUnread} onLogout={logout} signingOut={signingOut} toast={toast} />
        : route.view === 'admin' && admin
          ? <AdminScreen me={me} unread={unread} onChanged={() => { refreshAdmin(); refreshUnread(); }}
              onLogout={logout} signingOut={signingOut} onSignedOut={signedOut} toast={toast} />
        : route.view === 'projects' || route.view === 'admin'
          ? <ProjectsScreen me={me} onOpen={openProject} onLogout={logout} signingOut={signingOut} unread={unread} toast={toast} />
        : <BugPage key={route.projectId} me={me} projectId={route.projectId} bugId={route.bugId} toast={toast} unread={unread}
            onNotificationsChanged={refreshUnread} onBack={() => openProject(null)} onLogout={logout} signingOut={signingOut} onSignedOut={signedOut} />}
      <Toast toast={toastState} />
    </AdminBadge.Provider>
  );
}

function BugPage({ me, projectId, bugId, unread, onNotificationsChanged, onBack, onLogout, signingOut, onSignedOut, toast }) {
  const [project, setProject] = useState(null);
  const [panels, setPanels] = useState([]);
  const [bugs, setBugs] = useState([]);
  const [counts, setCounts] = useState({});
  const [users, setUsers] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [filters, setFilters] = useState({ status: '', priority: '', assignee: '', panel: '', q: '', sort: 'new' });
  // The open bug lives in the URL (#project-3/bug-12), so notifications can link to it and Back closes it
  const viewId = bugId ?? null;
  const setViewId = id => { location.hash = id ? `project-${projectId}/bug-${id}` : `project-${projectId}`; };
  const [form, setForm] = useState(null); // null | {bug?}
  const fileRef = useRef();
  const formDirty = useRef(false);
  const canCloseForm = () => !formDirty.current || window.confirm('Discard your changes? What you typed in this bug will be lost.');
  const me_ = me;
  const backRef = useRef(onBack);
  backRef.current = onBack;

  const [listLoading, setListLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const slow = useSlowHint(!loaded && !loadErr);
  // silent: background refresh (no loading bar, no dimmed list)
  const loadBugs = useCallback(async ({ silent } = {}) => {
    const qs = new URLSearchParams([['project', projectId], ...Object.entries(filters).filter(([, v]) => v)]).toString();
    if (!silent) setListLoading(true);
    try {
      const d = await api('/bugs?' + qs, { silent });
      setProject(d.project); setPanels(d.panels);
      setBugs(d.bugs); setCounts(d.counts); setLoadErr(''); setLoaded(true);
    } catch (e) {
      if (e.status === 401) onSignedOut();
      else if (e.status === 404) { toast(e.message, 'error'); backRef.current(); } // removed from the project, or it never existed
      else setLoadErr(e.message);
    } finally {
      if (!silent) setListLoading(false);
    }
  }, [filters, projectId, onSignedOut, toast]);
  const [teamOpen, setTeamOpen] = useState(false);
  const loadMembers = useCallback(() => api(`/projects/${projectId}/members`).then(setUsers).catch(() => {}), [projectId]);

  async function onImport(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const r = await importCsv(projectId, file);
      const msg = `Imported ${r.imported} bug${r.imported === 1 ? '' : 's'} successfully` + (r.duplicates ? ` (${r.duplicates} already here, skipped)` : '');
      toast(r.imported || !r.duplicates ? msg : `Nothing new to import: all ${r.duplicates} bugs are already here`, r.imported ? 'success' : 'error');
      loadBugs();
    } catch (e2) { toast(e2.message, 'error'); }
    setImporting(false);
  }
  async function onExport() {
    if (!project) return;
    setExporting(true);
    try { await downloadCsv(project); toast('CSV exported successfully'); }
    catch (e) { toast(e.message, 'error'); }
    setExporting(false);
  }

  useEffect(() => {
    const t = setTimeout(() => loadBugs(), filters.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadBugs, filters.q]);

  // Refresh every 15 s so status changes by others show up
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) loadBugs({ silent: true }); }, 15000);
    return () => clearInterval(t);
  }, [loadBugs]);

  useEffect(() => { loadMembers(); }, [loadMembers, form, bugs.length]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const setFilter = k => e => setFilters(f => ({ ...f, [k]: e.target.value }));
  const modules = [...new Set(bugs.map(b => b.module))].sort();
  const logout = onLogout;
  const filtered = ['status', 'priority', 'assignee', 'panel', 'q'].some(k => filters[k]);
  const clearFilters = () => setFilters(f => ({ ...f, status: '', priority: '', assignee: '', panel: '', q: '' }));
  const mine = filters.assignee === String(me.id);
  useEffect(() => { document.title = project ? `${project.name} · Bug Log` : 'Bug Log'; }, [project]);

  return (
    <>
      <header className="top">
        <div className="wrap">
          <button className="btn ghost back" onClick={onBack} aria-label="All projects">← Projects</button>
          <div className="brand"><h1>{project ? project.name : 'Loading…'}</h1><span className="sub">{me_.name} · {me_.role}</span></div>
          <div className="actions">
            <button className="btn" onClick={() => setTeamOpen(true)}>Team <span className="n">{users.length || ''}</span></button>
            {isTester(me) && <>
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onImport} />
              <BusyBtn className="btn" busy={importing} busyText="Importing…" onClick={() => fileRef.current.click()}>Import CSV</BusyBtn>
            </>}
            <BusyBtn className="btn" busy={exporting} disabled={!project} busyText="Exporting…" onClick={onExport}>Export CSV</BusyBtn>
            {isTester(me) && <button className="btn primary" disabled={!project} onClick={() => setForm({})}>+ Report bug</button>}
          </div>
          <TopRight unread={unread} onLogout={logout} signingOut={signingOut} />
        </div>
      </header>

      <main className="wrap">
        <div className="strip" role="group" aria-label="Filter by status">
          <button className="chip" aria-pressed={!filters.status} onClick={() => setFilters(f => ({ ...f, status: '' }))}>
            All <span className="n">{total}</span></button>
          {STATUSES.map(s => (
            <button key={s} className="chip" aria-pressed={filters.status === s}
              onClick={() => setFilters(f => ({ ...f, status: f.status === s ? '' : s }))}>
              <span className="dot" style={{ '--c': `var(${STATUS_VAR[s]})` }} />{s} <span className="n">{counts[s] || 0}</span>
            </button>
          ))}
        </div>

        <div className="filters">
          <input id="q" type="search" placeholder="Search ID (BUG-012), module, description…" value={filters.q} onChange={setFilter('q')} aria-label="Search bugs" />
          {isAssignable(me) && <button className="chip mine" aria-pressed={mine}
            onClick={() => setFilters(f => ({ ...f, assignee: mine ? '' : String(me.id) }))}>Assigned to me</button>}
          {panels.length > 0 && (
            <select id="f-panel" value={filters.panel} onChange={setFilter('panel')} aria-label="Panel">
              <option value="">All panels</option>{panels.map(p => <option key={p}>{p}</option>)}
            </select>
          )}
          <select id="f-pri" value={filters.priority} onChange={setFilter('priority')} aria-label="Priority">
            <option value="">All priorities</option>{PRIORITIES.map(p => <option key={p}>{p}</option>)}
          </select>
          <select id="f-asg" value={filters.assignee} onChange={setFilter('assignee')} aria-label="Assignee">
            <option value="">All assignees</option><option value="none">Unassigned</option>
            {users.filter(isAssignable).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select id="f-sort" value={filters.sort} onChange={setFilter('sort')} aria-label="Sort">
            <option value="new">Newest first</option><option value="old">Oldest first</option>
            <option value="priority">Priority</option><option value="updated">Recently updated</option>
          </select>
          {filtered && <button className="btn ghost clear" onClick={clearFilters}>✕ Clear filters</button>}
        </div>

        {loadErr && <div className="notice">{loadErr}</div>}
        {slow && <p className="hint slow">The server is waking up. This can take up to a minute the first time.</p>}

        <div className={'list' + (loaded && listLoading ? ' refreshing' : '')} aria-busy={listLoading || undefined}>
          <div className="row head"><span>ID</span><span>Module · Description</span><span>Priority</span><span>Status</span><span>Assignee</span><span>Reported</span></div>
          {!loaded && !loadErr && <>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="row skeleton" aria-hidden="true"><span /><span /><span /><span /><span /><span /></div>
            ))}
            <span className="sr-only" role="status">Loading bugs…</span>
          </>}
          {loaded && bugs.length === 0 && (
            <div className="empty">
              {total === 0
                ? <><h2>No bugs in this project yet</h2><p>{isTester(me)
                    ? 'Click “+ Report bug” to log one, or “Import CSV” to bring in a spreadsheet.'
                    : 'Testers report bugs here. They will show up as soon as they are logged.'}</p></>
                : <><h2>No bugs match these filters</h2><p>{mine ? 'Nothing is assigned to you here right now.' : 'Try another status or search.'}</p>
                    <button className="btn" onClick={clearFilters}>Clear filters</button></>}
            </div>
          )}
          {bugs.map(b => (
            <button key={b.id} className="row" onClick={() => setViewId(b.id)}>
              <span className="key">{b.key}</span>
              <span className="title"><b>{b.description}</b><small>{b.panel ? `${b.panel} · ` : ''}{b.module}</small></span>
              <Priority priority={b.priority} />
              <span className="st"><StatusPill status={b.status} /></span>
              <span className="who">{b.assignee_name || 'Unassigned'}</span>
              <span className="date">{fmtDate(b.date_reported)}</span>
            </button>
          ))}
        </div>
        <p className="foot">The list refreshes every 15 seconds. Every status change is logged in the bug's history.</p>
      </main>

      <Modal open={viewId != null} onClose={() => setViewId(null)} className="sheet" labelledBy="view-title">
        <BugDetail id={viewId} me={me} toast={toast} onClose={() => setViewId(null)} onChanged={() => loadBugs()}
          onNotificationsChanged={onNotificationsChanged}
          onEdit={bug => { setViewId(null); setForm({ bug }); }} />
      </Modal>

      <Modal open={teamOpen && !!project} onClose={() => setTeamOpen(false)} className="form team-dlg" labelledBy="team-title">
        {project && <TeamPanel project={project} me={me} members={users} toast={toast} onClose={() => setTeamOpen(false)}
          onChanged={() => { loadMembers(); loadBugs(); }} />}
      </Modal>

      <Modal open={form != null} onClose={() => setForm(null)} className="form" labelledBy="form-title" canClose={canCloseForm}>
        <BugForm bug={form?.bug} project={project} users={users} modules={modules} panels={panels} dirtyRef={formDirty}
          onCancel={() => { if (canCloseForm()) setForm(null); }}
          onSaved={(bug, created) => {
            toast(created ? `${bug.key} reported successfully` : `${bug.key} updated successfully`);
            setForm(null); setViewId(bug.id);
            // A new bug should always be visible in the list, so drop any filters or search.
            // Changing the filters reloads the list by itself; otherwise reload it here.
            if (created && filtered) clearFilters(); else loadBugs();
          }} />
      </Modal>
    </>
  );
}
