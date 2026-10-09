import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiRequestError, api, type ForumMember, type ForumMembers, type ForumModAction, type ForumRole, type ForumRow,
} from '../api';
import { Avatar, Modal, useConfirm } from './ui';
import { Icon } from './Icon';
import { useToast } from './Feedback';
import { timeAgo } from '../format';

type Pane = 'members' | 'banned' | 'warnings' | 'settings';

const ROLE_LABEL: Record<ForumRole, string> = { admin: 'Admin', moderator: 'Moderator', member: 'Member' };

/** The role chip beside a name. */
export function RoleChip({ role }: { role: ForumRole | null | undefined }) {
  if (!role || role === 'member') return null;
  return <span className={`forumrole forumrole--${role}`}>{ROLE_LABEL[role]}</span>;
}

/**
 * Who is in a forum, and - for its admin and moderators - the tools to keep it
 * in order: add and remove people, keep them out, warn them, and (admin only)
 * appoint up to two moderators. Nobody can act against the admin, and a
 * moderator cannot act against another moderator.
 */
export function ForumPeople({ forumId, description, rules, onClose, onForum }: {
  forumId: string;
  description: string;
  rules: string;
  onClose: () => void;
  onForum: (row: ForumRow) => void;
}) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [data, setData] = useState<ForumMembers | null>(null);
  const [pane, setPane] = useState<Pane>('members');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [warning, setWarning] = useState<{ member: ForumMember; note: string } | null>(null);
  const [about, setAbout] = useState(description);
  const [houseRules, setHouseRules] = useState(rules);

  const load = useCallback(async () => {
    try {
      setData(await api.forumMembers(forumId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the members.');
    }
  }, [forumId]);
  useEffect(() => { void load(); }, [load]);

  const runs = data?.role === 'admin' || data?.role === 'moderator';
  const isAdmin = data?.role === 'admin';
  const mods = data?.members.filter((member) => member.role === 'moderator').length ?? 0;

  async function act(action: ForumModAction, user: string | undefined, done: string, extra: { note?: string; description?: string; rules?: string } = {}) {
    setBusy(true);
    setError(null);
    try {
      const { forum } = await api.moderateForum(forumId, { action, user, ...extra });
      onForum(forum);
      toast(done, 'ok');
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not work.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function guarded(action: ForumModAction, member: ForumMember, title: string, done: string) {
    if (!(await confirm({ title, action: title.split(' ')[0]!, danger: action === 'ban' || action === 'remove' }))) return;
    await act(action, member.id, done);
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const handle = adding.trim().replace(/^@/, '');
    if (!handle) return;
    if (await act('add', handle, `@${handle} added.`)) setAdding('');
  }

  const panes: [Pane, string][] = runs
    ? [['members', 'Members'], ['banned', `Banned ${data?.banned.length ?? 0}`], ['warnings', 'Warnings'], ['settings', 'Settings']]
    : [['members', 'Members']];

  return (
    <Modal title="Forum members" onClose={onClose}>
      {dialog}
      <div className="forummod">
        {panes.length > 1 && (
          <div className="chips chips--tight" role="tablist">
            {panes.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={pane === id}
                className={`chip${pane === id ? ' is-on' : ''}`} onClick={() => setPane(id)}>{label}</button>
            ))}
          </div>
        )}
        {error && <p className="spost__error">{error}</p>}
        {!data && !error && <p className="muted">Loading…</p>}

        {data && pane === 'members' && (
          <>
            {runs && (
              <form className="forummod__add" onSubmit={add}>
                <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="@handle to add" aria-label="Add a member by handle" />
                <button type="submit" className="btn btn--sm" disabled={busy || !adding.trim()}>Add</button>
              </form>
            )}
            {isAdmin && <p className="faint">{mods} of {data.moderatorsMax} moderators appointed.</p>}
            <ul className="forummod__list">
              {data.members.map((member) => {
                // The admin is untouchable; a moderator cannot act on another moderator.
                const actable = runs && member.role !== 'admin' && (isAdmin || member.role === 'member');
                return (
                  <li key={member.id} className="forummod__row">
                    <Avatar name={member.name} size={32} />
                    <span className="forummod__who">
                      {member.handle ? <Link to={`/${member.handle}`} onClick={onClose}><strong>{member.name}</strong></Link> : <strong>{member.name}</strong>}
                      <span className="faint">
                        {member.handle && `@${member.handle}`}
                        {runs && member.warnings > 0 && ` · ${member.warnings} warning${member.warnings === 1 ? '' : 's'}`}
                      </span>
                    </span>
                    <RoleChip role={member.role} />
                    {actable && (
                      <span className="forummod__acts">
                        <button type="button" className="btn btn--quiet btn--sm" disabled={busy}
                          onClick={() => setWarning({ member, note: '' })}>Warn</button>
                        {isAdmin && (member.role === 'moderator' ? (
                          <button type="button" className="btn btn--quiet btn--sm" disabled={busy}
                            onClick={() => void act('demote', member.id, `${member.name} is no longer a moderator.`)}>Unmod</button>
                        ) : (
                          <button type="button" className="btn btn--quiet btn--sm" disabled={busy || mods >= data.moderatorsMax}
                            title={mods >= data.moderatorsMax ? `${data.moderatorsMax} moderators at most` : undefined}
                            onClick={() => void act('promote', member.id, `${member.name} is now a moderator.`)}>Make mod</button>
                        ))}
                        <button type="button" className="btn btn--quiet btn--sm" disabled={busy}
                          onClick={() => void guarded('remove', member, `Remove ${member.name}?`, `${member.name} removed.`)}>Remove</button>
                        <button type="button" className="btn btn--quiet btn--sm is-danger" disabled={busy}
                          onClick={() => void guarded('ban', member, `Ban ${member.name}?`, `${member.name} banned.`)}>Ban</button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {data && pane === 'banned' && (
          data.banned.length === 0 ? <p className="muted">Nobody is banned.</p> : (
            <ul className="forummod__list">
              {data.banned.map((person) => (
                <li key={person.id} className="forummod__row">
                  <Avatar name={person.name} size={32} />
                  <span className="forummod__who"><strong>{person.name}</strong>{person.handle && <span className="faint">@{person.handle}</span>}</span>
                  <button type="button" className="btn btn--quiet btn--sm" disabled={busy}
                    onClick={() => void act('unban', person.id, `${person.name} may join again.`)}>Unban</button>
                </li>
              ))}
            </ul>
          )
        )}

        {data && pane === 'warnings' && (
          data.warnings.length === 0 ? <p className="muted">No warnings handed out.</p> : (
            <ul className="forummod__list">
              {data.warnings.map((entry, index) => (
                <li key={`${entry.userId}-${index}`} className="forummod__warn">
                  <strong>{entry.name}</strong> <span className="faint">by {entry.by} · {timeAgo(entry.at)}</span>
                  <p>{entry.note}</p>
                </li>
              ))}
            </ul>
          )
        )}

        {data && pane === 'settings' && (
          <form className="forummod__settings" onSubmit={(event) => {
            event.preventDefault();
            void act('edit', undefined, 'Forum updated.', { description: about, rules: houseRules });
          }}>
            <label>About<input value={about} maxLength={200} onChange={(e) => setAbout(e.target.value)} /></label>
            <label>House rules<textarea value={houseRules} maxLength={1000} rows={5} onChange={(e) => setHouseRules(e.target.value)}
              placeholder="Be kind. No selling outside Figmark. Photos of the actual item only." /></label>
            <button type="submit" className="btn" disabled={busy}>Save</button>
          </form>
        )}

        {warning && (
          <form className="forummod__warnform" onSubmit={async (event) => {
            event.preventDefault();
            if (await act('warn', warning.member.id, `${warning.member.name} warned.`, { note: warning.note })) setWarning(null);
          }}>
            <strong><Icon name="bell" size={14} /> Warn {warning.member.name}</strong>
            <textarea value={warning.note} autoFocus rows={3} maxLength={300} placeholder="What for - they will see this."
              onChange={(e) => setWarning({ ...warning, note: e.target.value })} />
            <span className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setWarning(null)}>Cancel</button>
              <button type="submit" className="btn btn--sm" disabled={busy || !warning.note.trim()}>Send warning</button>
            </span>
          </form>
        )}
      </div>
    </Modal>
  );
}
