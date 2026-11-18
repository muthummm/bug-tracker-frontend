// Super admin panel: approve or reject sign-up requests, and activate or deactivate testers and developers.
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, fmtDate, fmtTime } from './api.js';
import { AdminBadge, BusyBtn, Loader, TopRight } from './ui.jsx';

const TABS = [
  ['pending', 'Requests'],
  ['active', 'Active'],
  ['inactive', 'Inactive'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
];

const STATUS_LOOK = {
  pending: ['Waiting for approval', '--s-prog'],
  active: ['Active', '--s-fixed'],
  inactive: ['Inactive', '--s-closed'],
  rejected: ['Rejected', '--s-reopen'],
};

const EMPTY_TEXT = {
  pending: ['No requests waiting', 'When a tester or developer signs up, their request shows up here and you get a notification.'],
  active: ['No active accounts', 'Approve a sign-up request to give someone access.'],
  inactive: ['No inactive accounts', 'Deactivated accounts show up here. They can’t sign in until you activate them again.'],
  rejected: ['No rejected requests', 'Requests you reject show up here. You can still approve them later.'],
  all: ['No accounts yet', 'Testers and developers appear here once they request an account.'],
};

const roleLabel = role => (role === 'Tester' ? 'Tester (QA)' : role);

const AccountStatus = ({ status }) => {
  const [label, color] = STATUS_LOOK[status] || [status, '--muted'];
  return <span className="status" style={{ '--c': `var(${color})` }}><span className="dot" />{label}</span>;
};

/** The buttons for one account; `confirm` asks again before the actions that lock someone out. */
function AccountActions({ user, busy, onAct }) {
  const [confirming, setConfirming] = useState(null); // 'reject' | 'deactivate'
  const pending = action => busy === `${action}:${user.id}`;
  const locked = Boolean(busy);

  if (confirming) {
    const text = confirming === 'reject'
      ? `Reject ${user.name}'s request? They won't be able to sign in.`
      : `Deactivate ${user.name}? They are signed out right away and can't sign in until you activate them.`;
    return (
      <span className="t-confirm acct-confirm">
        <span>{text}</span>
        <BusyBtn className="btn danger" busy={pending(confirming)} disabled={locked} busyText={confirming === 'reject' ? 'Rejecting…' : 'Deactivating…'}
          onClick={() => onAct(user, confirming).then(() => setConfirming(null))}>
          {confirming === 'reject' ? 'Yes, reject' : 'Yes, deactivate'}</BusyBtn>
        <button className="btn" disabled={locked} onClick={() => setConfirming(null)}>Cancel</button>
      </span>
    );
  }

  return (
    <span className="acct-actions">
      {(user.status === 'pending' || user.status === 'rejected') && (
        <BusyBtn className="btn primary" busy={pending('approve')} disabled={locked} busyText="Approving…" onClick={() => onAct(user, 'approve')}>
          Approve</BusyBtn>
      )}
      {user.status === 'pending' && (
        <button className="btn ghost danger" disabled={locked} onClick={() => setConfirming('reject')}>Reject</button>
      )}
      {user.status === 'active' && (
        <button className="btn ghost danger" disabled={locked} onClick={() => setConfirming('deactivate')}>Deactivate</button>
      )}
      {user.status === 'inactive' && (
        <BusyBtn className="btn" busy={pending('activate')} disabled={locked} busyText="Activating…" onClick={() => onAct(user, 'activate')}>
          Activate</BusyBtn>
      )}
    </span>
  );
}

const ACTIONS = {
  approve: u => api(`/admin/users/${u.id}/approve`, { method: 'POST' }),
  reject: u => api(`/admin/users/${u.id}/reject`, { method: 'POST' }),
  activate: u => api(`/admin/users/${u.id}/status`, { method: 'PATCH', body: { status: 'active' } }),
  deactivate: u => api(`/admin/users/${u.id}/status`, { method: 'PATCH', body: { status: 'inactive' } }),
};
const DONE_TEXT = {
  approve: u => `${u.name} approved. They can sign in now. Add them to a project from its Team.`,
  reject: u => `${u.name}'s request rejected.`,
  activate: u => `${u.name}'s account is active again.`,
  deactivate: u => `${u.name} deactivated and signed out.`,
};

export default function AdminScreen({ me, unread, onChanged, onLogout, signingOut, onSignedOut, toast }) {
  const { pending: pendingBadge } = useContext(AdminBadge);
  const [tab, setTab] = useState('pending');
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null); // { counts, users }
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(''); // '<action>:<user id>'

  const load = useCallback(async ({ silent } = {}) => {
    const qs = new URLSearchParams([['status', tab === 'all' ? '' : tab], ['role', role], ['q', q.trim()]].filter(([, v]) => v));
    try {
      setData(await api('/admin/users?' + qs, { silent }));
      setErr('');
    } catch (e) {
      if (e.status === 401) onSignedOut();
      else setErr(e.message);
    }
  }, [tab, role, q, onSignedOut]);

  useEffect(() => {
    const t = setTimeout(() => load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  // The header's poll saw a new request while this page is open: refresh the list quietly
  const lastBadge = useRef(pendingBadge);
  useEffect(() => {
    if (pendingBadge > lastBadge.current) load({ silent: true });
    lastBadge.current = pendingBadge;
  }, [pendingBadge, load]);
  useEffect(() => { document.title = 'Admin panel · Bug Log'; }, []);

  async function act(user, action) {
    setBusy(`${action}:${user.id}`);
    try {
      await ACTIONS[action](user);
      toast(DONE_TEXT[action](user));
      await load({ silent: true });
      onChanged();
    } catch (e) { toast(e.message, 'error'); }
    setBusy('');
  }

  const counts = data?.counts || {};
  const filtered = Boolean(role || q.trim());
  const [emptyTitle, emptyText] = EMPTY_TEXT[tab];

  return (
    <>
      <header className="top">
        <div className="wrap">
          <a className="btn ghost back" href="#">← Projects</a>
          <div className="brand"><h1>Admin panel</h1><span className="sub">{me.name} · {me.role}</span></div>
          <TopRight unread={unread} onLogout={onLogout} signingOut={signingOut} adminActive />
        </div>
      </header>

      <main className="wrap admin">
        <p className="admin-intro">
          New testers and developers can’t sign in until you approve them. Add people to projects from each project’s <b>Team</b>.
        </p>

        <div className="strip" role="group" aria-label="Show accounts">
          {TABS.map(([key, label]) => (
            <button key={key} className={'chip' + (key === 'pending' && counts.pending ? ' attention' : '')} aria-pressed={tab === key}
              onClick={() => setTab(key)}>
              {key !== 'all' && <span className="dot" style={{ '--c': `var(${STATUS_LOOK[key][1]})` }} />}
              {label} <span className="n">{counts[key] ?? '·'}</span>
            </button>
          ))}
        </div>

        <div className="filters">
          <input id="a-q" type="search" placeholder="Search by name or username…" value={q} onChange={e => setQ(e.target.value)}
            aria-label="Search accounts" autoComplete="off" />
          <select id="a-role" value={role} onChange={e => setRole(e.target.value)} aria-label="Role">
            <option value="">All roles</option><option value="Tester">Testers (QA)</option><option value="Developer">Developers</option>
          </select>
          {filtered && <button className="btn ghost clear" onClick={() => { setRole(''); setQ(''); }}>✕ Clear filters</button>}
        </div>

        {err && <div className="notice">{err}</div>}

        <div className="list accounts" aria-busy={data === null || undefined}>
          {data === null && !err && <Loader text="Loading accounts…" />}
          {data && data.users.length === 0 && (
            <div className="empty">
              {filtered
                ? <><h2>No accounts match</h2><p>Try another name, or clear the filters.</p></>
                : <><h2>{emptyTitle}</h2><p>{emptyText}</p></>}
            </div>
          )}
          {data && data.users.map(u => (
            <div key={u.id} className={'acct' + (u.status === 'pending' ? ' is-pending' : '')}>
              <span className="acct-who">
                <b>{u.name}</b>
                <small>{u.username} · {roleLabel(u.role)}</small>
              </span>
              <span className="acct-status"><AccountStatus status={u.status} /></span>
              <span className="acct-meta">
                <small title={fmtTime(u.created_at)}>Signed up {fmtDate(u.created_at)}</small>
                <small>{u.status === 'pending'
                  ? 'Not reviewed yet'
                  : `${u.projects} project${u.projects === 1 ? '' : 's'}${u.reviewed_by_name ? ` · by ${u.reviewed_by_name}` : ''}`}</small>
              </span>
              <AccountActions user={u} busy={busy} onAct={act} />
            </div>
          ))}
        </div>
        <p className="foot">Deactivating someone signs them out immediately. Their bugs and history stay as they are.</p>
      </main>
    </>
  );
}
