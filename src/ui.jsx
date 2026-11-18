// Small building blocks shared by every screen: spinners, buttons and the header's right side.
import { createContext, useContext, useEffect, useState } from 'react';
import { subscribePending } from './api.js';

// ---------- loading indicators ----------
export const Spinner = ({ size }) => <span className={'spinner' + (size ? ' ' + size : '')} aria-hidden="true" />;

// A button that shows a spinner and "busyText" while its request is pending.
export function BusyBtn({ busy, busyText, disabled, children, className = 'btn', ...rest }) {
  return (
    <button className={className + (busy ? ' is-busy' : '')} disabled={busy || disabled} aria-busy={busy || undefined} {...rest}>
      {busy && <Spinner />}{busy && busyText ? busyText : children}
    </button>
  );
}

export function Loader({ text = 'Loading…', full }) {
  return <div className={'loader' + (full ? ' full' : '')} role="status"><Spinner size="lg" /><span>{text}</span></div>;
}

// Thin bar across the top of the page while any API request is pending.
// Waits 150 ms before showing so very fast requests don't flicker.
export function TopProgress() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let t;
    const unsub = subscribePending(n => {
      clearTimeout(t);
      if (n > 0) t = setTimeout(() => setActive(true), 150);
      else setActive(false);
    });
    return () => { clearTimeout(t); unsub(); };
  }, []);
  return <div className={'top-progress' + (active ? ' on' : '')} role="progressbar" aria-hidden={!active} aria-label="Loading" />;
}

// The free backend host sleeps when idle; tell the user if the first request is slow.
export function useSlowHint(busy, ms = 5000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [busy, ms]);
  return slow;
}

// ---------- header ----------
// Lets the header show the super admin's "Admin" link with the number of sign-up requests waiting.
// show: the signed-in person is the super admin; refresh(): re-count after approving/rejecting.
export const AdminBadge = createContext({ show: false, pending: 0, refresh: () => {} });

const Badge = ({ n }) => (n > 0 ? <span className="bell-dot">{n > 99 ? '99+' : n}</span> : null);

// Bell in the top-right corner; the red dot shows how many notifications are unread.
function Bell({ count, active }) {
  const label = count ? `Notifications, ${count} unread` : 'Notifications';
  return (
    <a className={'btn ghost bell' + (active ? ' active' : '')} href="#notifications" aria-label={label} title={label}
      aria-current={active ? 'page' : undefined}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <Badge n={count} />
    </a>
  );
}

// People icon, used for the super admin's Members page
export const MembersIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

// Super admin only: link to the Members page, with the number of sign-up requests waiting.
function MembersLink({ pending, active }) {
  const label = pending ? `Members, ${pending} sign-up request${pending === 1 ? '' : 's'} waiting` : 'Members';
  return (
    <a className={'btn ghost bell admin-link' + (active ? ' active' : '')} href="#members" aria-label={label} title={label}
      aria-current={active ? 'page' : undefined}>
      <MembersIcon />
      <span className="admin-label">Members</span>
      <Badge n={pending} />
    </a>
  );
}

export function TopRight({ unread, onLogout, signingOut, bellActive, adminActive }) {
  const admin = useContext(AdminBadge);
  return (
    <div className={'top-right' + (admin.show ? ' has-admin' : '')}>
      {admin.show && <MembersLink pending={admin.pending} active={adminActive} />}
      <Bell count={unread} active={bellActive} />
      <BusyBtn className="btn ghost signout" busy={signingOut} busyText="Signing out…" onClick={onLogout}>Sign out</BusyBtn>
    </div>
  );
}
