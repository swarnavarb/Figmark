import type { IconName } from '../components/Icon';
import type { OverviewQueues } from '@shared/overview';

/**
 * Every screen in the console, grouped the way an operator's day runs: what is
 * happening, who is here, what is waiting, the money, and the marketplace's
 * own machinery. The sidebar, the phone's menu and the dashboard's shortcuts
 * all read this one list.
 */

export type Tab =
  | 'overview' | 'users' | 'stores' | 'disputes' | 'approvals' | 'payments' | 'reports'
  | 'devices' | 'photos' | 'routes' | 'challenge' | 'settings' | 'learn' | 'audit';

export interface Section {
  tab: Tab;
  label: string;
  icon: IconName;
  /** The queue whose count the menu shows beside it, if any. */
  queue?: keyof OverviewQueues;
}

export const GROUPS: { title: string | null; sections: Section[] }[] = [
  { title: null, sections: [{ tab: 'overview', label: 'Overview', icon: 'home' }] },
  {
    title: 'People',
    sections: [
      { tab: 'users', label: 'People and stores', icon: 'users' },
      { tab: 'stores', label: 'Service stores', icon: 'box', queue: 'storesPending' },
    ],
  },
  {
    title: 'Cases',
    sections: [
      { tab: 'disputes', label: 'Disputes', icon: 'forum', queue: 'disputesOpen' },
      { tab: 'approvals', label: 'Approvals', icon: 'check', queue: 'actionsPending' },
      { tab: 'reports', label: 'Reports', icon: 'megaphone', queue: 'reportsOpen' },
    ],
  },
  { title: 'Money', sections: [{ tab: 'payments', label: 'Payments', icon: 'bank' }] },
  {
    title: 'Platform',
    sections: [
      { tab: 'devices', label: 'Installs & devices', icon: 'phone' },
      { tab: 'photos', label: 'Stored photos', icon: 'image' },
      { tab: 'routes', label: 'Routes', icon: 'truck' },
      { tab: 'challenge', label: 'Weekly challenge', icon: 'trophy' },
      { tab: 'learn', label: 'Learn page', icon: 'bookmark' },
      { tab: 'settings', label: 'Settings', icon: 'filter' },
      { tab: 'audit', label: 'Audit trail', icon: 'lock' },
    ],
  },
];

export const SECTIONS: Record<Tab, Section> = Object.fromEntries(
  GROUPS.flatMap((group) => group.sections).map((section) => [section.tab, section]),
) as Record<Tab, Section>;

export const isTab = (value: string): value is Tab => value in SECTIONS;
