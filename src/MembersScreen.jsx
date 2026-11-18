// Super admin "Members" page: every tester and developer, with their projects. The admin activates or
// deactivates accounts here, and approves or rejects new sign-up requests.
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, fmtDate, fmtTime } from './api.js';
import { AdminBadge, BusyBtn, Loader, TopRight } from './ui.jsx';

const TABS = [
  ['all', 'All members'],
  ['active', 'Active'],
  ['inactive', 'Inactive'],
  ['pending', 'Requests'],
  ['rejected', 'Rejected'],
];

const STATUS_LOOK = {
  pending: ['Waiting for approval', '--s-prog'],
  active: ['Active', '--s-fixed'],
  inactive: ['Inactive', '--s-closed'],
  rejected: ['Rejected', '--s-reopen'],
};

const EMPTY_TEXT = {
  all: ['No members yet', 'Testers and developers appear here once they request an account and you approve it.'],
  active: ['No active members', 'Approve a sign-up request, or activate an inactive member.'],
  inactive: ['No inactive members', 'Members you deactivate show up here. They can’t sign in until you activate them again.'],
  pending: ['No requests waiting', 'When a tester or developer signs up, their request shows up here and you get a notification.'],
  rejected: ['No rejected requests', 'Requests you reject show up here. You can still approve them later.'],
};

const roleLabel = role => (role === 'Tester' ? 'Tester (QA)' : role);

const AccountStatus = ({ status }) => {
  const [label, color] = STATUS_LOOK[status] || [status, '--muted'];
  return <span className="status" style={{ '--c': `var(${color})` }}><span className="dot" />{label}</span>;
};

/** The buttons for one member; asks again before the actions that lock someone out. */
function MemberActions({ user, busy, onAct }) {
  const [confirming, setConfirming] = useState(null); // 'reject' | 'deactivate'
  const pending = action => busy === `${action}:${user.id}`;
  const locked = Boolean(busy);

  if (confirming) {
    const text = confirming === 'reject'
      ? `Reject ${user.name}'s request? They won't be able to sign in.`
      : `Deactivate ${user.name}? They are signed out right away and can't sign in until you activate them again.`;
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
        <button className="btn danger" disabled={locked} onClick={() => setConfirming('reject')}>Reject</button>
      )}
      {user.status === 'active' && (
        <button className="btn danger" disabled={locked} onClick={() => setConfirming('deactivate')}>Deactivate</button>
      )}
      {user.status === 'inactive' && (
        <BusyBtn className="btn primary" busy={pending('activate')} disabled={locked} busyText="Activating…" onClick={() => onAct(user, 'activate')}>
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
  activate: u => `${u.name} is active again and can sign in.`,
  deactivate: u => `${u.name} deactivated and signed out.`,
};

/** e.g. "approved by Vash on 18 Nov 2026" */
function reviewLine(u) {
  if (u.status === 'pending') return 'Waiting for your approval';
  const verb = { active: 'approved', inactive: 'deactivated', rejected: 'rejected' }[u.status];
  return u.reviewed_by_name ? `${verb} by ${u.reviewed_by_name}${u.reviewed_at ? ` on ${fmtDate(u.reviewed_at)}` : ''}` : '';
}

export default function MembersScreen({ me, unread, onChanged, onLogout, signingOut, onSignedOut, toast }) {
  const { pending: pendingBadge } = useContext(AdminBadge);
  // Open on the requests when someone is waiting, otherwise on the full member list
  const [tab, setTab] = useState(() => (pendingBadge > 0 ? 'pending' : 'all'));
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
  useEffect(() => { document.title = 'Members · Bug Log'; }, []);

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
          <div className="brand"><h1>Members</h1><span className="sub">{me.name} · {me.role}</span></div>
          <TopRight unread={unread} onLogout={onLogout} signingOut={signingOut} adminActive />
        </div>
      </header>

      <main className="wrap admin">
        <p className="admin-intro">
          Every tester and developer. Deactivate someone to stop them signing in; activate them to let them back in.
          New sign-ups wait under <b>Requests</b> until you approve them. Add people to a project from its <b>Team</b>.
        </p>

        <div className="strip" role="group" aria-label="Show members">
          {TABS.map(([key, label]) => (
            <button key={key} className={'chip' + (key === 'pending' && counts.pending ? ' attention' : '')} aria-pressed={tab === key}
              onClick={() => setTab(key)}>
              {key !== 'all' && <span className="dot" style={{ '--c': `var(${STATUS_LOOK[key][1]})` }} />}
              {label} <span className="n">{counts[key] ?? '·'}</span>
            </button>
          ))}
        </div>

        <div className="filters">
          <input id="m-q" type="search" placeholder="Search members by name or username…" value={q} onChange={e => setQ(e.target.value)}
            aria-label="Search members" autoComplete="off" />
          <select id="m-role" value={role} onChange={e => setRole(e.target.value)} aria-label="Role">
            <option value="">All roles</option><option value="Tester">Testers (QA)</option><option value="Developer">Developers</option>
          </select>
          {filtered && <button className="btn ghost clear" onClick={() => { setRole(''); setQ(''); }}>✕ Clear filters</button>}
        </div>

        {err && <div className="notice">{err}</div>}

        <div className="list accounts" aria-busy={data === null || undefined}>
          {data && data.users.length > 0 && (
            <div className="acct head" aria-hidden="true"><span>Member</span><span>Status</span><span>Projects</span><span /></div>
          )}
          {data === null && !err && <Loader text="Loading members…" />}
          {data && data.users.length === 0 && (
            <div className="empty">
              {filtered
                ? <><h2>No members match</h2><p>Try another name, or clear the filters.</p></>
                : <><h2>{emptyTitle}</h2><p>{emptyText}</p></>}
            </div>
          )}
          {data && data.users.map(u => (
            <div key={u.id} className={'acct' + (u.status === 'pending' ? ' is-pending' : '') + (u.status === 'inactive' ? ' is-inactive' : '')}>
              <span className="acct-who">
                <b>{u.name}</b>
                <small>{u.username} · {roleLabel(u.role)}</small>
                <small title={fmtTime(u.created_at)}>Signed up {fmtDate(u.created_at)}</small>
              </span>
              <span className="acct-status">
                <AccountStatus status={u.status} />
                {reviewLine(u) && <small>{reviewLine(u)}</small>}
              </span>
              <span className="acct-meta">
                {u.project_list?.length
                  ? <span className="acct-projects">{u.project_list.map(p => <a key={p.id} className="proj-tag" href={`#project-${p.id}`}>{p.name}</a>)}</span>
                  : <small>{u.status === 'active' ? 'Not in any project yet' : '—'}</small>}
              </span>
              <MemberActions user={u} busy={busy} onAct={act} />
            </div>
          ))}
        </div>
        <p className="foot">Deactivating someone signs them out immediately. Their bugs, comments and history stay as they are.</p>
      </main>
    </>
  );
}
