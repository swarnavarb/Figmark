import { useId, useSyncExternalStore } from 'react';
import { api, type CommunityTeamMember } from '../api';
import { formatDate } from '../format';

/*
 * Who the community managers are, fetched once per visit and shared by every
 * name on screen. The badge goes wherever a manager's name does - posts,
 * comments, reviews, disputes, checkout - and most of those places only know
 * a handle or an id, so the lookup takes either.
 */

type Team = { byId: Map<string, CommunityTeamMember>; byHandle: Map<string, CommunityTeamMember> };

let team: Team | null = null;
let loading = false;
const listeners = new Set<() => void>();

function load() {
  if (team || loading) return;
  loading = true;
  api.communityTeam()
    .then(({ managers }) => {
      team = {
        byId: new Map(managers.map((member) => [member.id, member])),
        byHandle: new Map(managers.flatMap((member) => member.handles.map((handle) => [handle.toLowerCase(), member] as const))),
      };
      listeners.forEach((notify) => notify());
    })
    .catch(() => undefined)
    .finally(() => { loading = false; });
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  load();
  return () => { listeners.delete(notify); };
}

/** The manager behind an id or a handle, or null for everybody else. */
export function useCommunityManager(who: { id?: string | null; handle?: string | null }): CommunityTeamMember | null {
  const current = useSyncExternalStore(subscribe, () => team, () => null);
  if (!current) return null;
  return (who.id && current.byId.get(who.id))
    || (who.handle && current.byHandle.get(who.handle.replace(/^@/, '').toLowerCase()))
    || null;
}

/** Forget the list, after an operator appoints or removes somebody. */
export function refreshCommunityTeam() {
  team = null;
  load();
}

function Shield({ size }: { size: number }) {
  // Each its own gradient: a shared id breaks when the first copy is hidden.
  const fill = `cmshield-${useId().replace(/:/g, '')}`;
  return (
    <svg className="cmshield" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd56b" />
          <stop offset="0.55" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <path d="M12 2.2 4 5.2v6.1c0 5 3.4 9.3 8 10.5 4.6-1.2 8-5.5 8-10.5V5.2l-8-3Z" fill={`url(#${fill})`} stroke="#92400e" strokeWidth="1.1" />
      <path d="m12 7.1 1.45 2.95 3.25.47-2.35 2.3.55 3.24L12 14.53l-2.9 1.53.55-3.24-2.35-2.3 3.25-.47L12 7.1Z" fill="#fff" />
    </svg>
  );
}

/**
 * The small shield beside a manager's name, everywhere it appears.
 * Renders nothing for anybody else, so it can be dropped next to any name.
 */
export function ManagerMark({ id, handle, size = 14, always = false }: {
  id?: string | null;
  handle?: string | null;
  size?: number;
  /** Where the name is a manager's by definition: a picker, a decision, a notice. */
  always?: boolean;
}) {
  const manager = useCommunityManager({ id, handle });
  if (!manager && !always) return null;
  return (
    <span className="cmmark" title="Community manager" aria-label="Community manager" role="img">
      <Shield size={size} />
    </span>
  );
}

/** The tag under a manager's name on their profile. */
export function ManagerTag({ id, handle }: { id?: string | null; handle?: string | null }) {
  const manager = useCommunityManager({ id, handle });
  if (!manager) return null;
  return (
    <span className="cmtag" title={`Appointed by Figmark ${formatDate(manager.since)} to hear disputes and hold protected payments`}>
      <Shield size={18} />
      <span className="cmtag__text">
        <b>Community Manager</b>
        <small>since {formatDate(manager.since)}</small>
      </span>
    </span>
  );
}
