import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from './Feedback';
import { disablePush, enablePush, pushState, syncPush, type PushState } from '../push';

/**
 * Lock-screen notifications for this device: where it stands, and the one
 * thing to do about it.
 *
 * In two places: the bell, where people look for notifications, and the
 * profile page, which always says where things stand - including why nothing
 * is arriving - and has the test button.
 */
export function usePush() {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  // A device that is on stays on for whoever is signed in now.
  useEffect(() => {
    void syncPush().then(pushState).then(setState);
  }, []);

  const turnOn = useCallback(async () => {
    setBusy(true);
    try {
      const next = await enablePush();
      setState(next);
      if (next === 'on') toast('Notifications are on for this device.');
      else if (next === 'blocked') toast('Notifications are blocked. Allow them for this site in your settings.', 'error');
    } catch {
      toast('Could not turn notifications on. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const turnOff = useCallback(async () => {
    setBusy(true);
    try {
      await disablePush();
      setState(await pushState());
    } catch {
      toast('Could not turn notifications off. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const sendTest = useCallback(async () => {
    try {
      const { sent } = await api.pushTest();
      toast(
        sent > 0 ? 'Sent. It should appear in a moment.' : 'No device took it. Turn notifications off and on again.',
        sent > 0 ? 'ok' : 'error',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send a test.', 'error');
    }
  }, [toast]);

  return { state, busy, turnOn, turnOff, sendTest };
}

type Push = ReturnType<typeof usePush>;

/** The words for each state; null where there is nothing worth saying. */
function explain(state: PushState): string | null {
  switch (state) {
    case 'needs-install':
      return 'On iPhone, notifications only work from the home screen: tap Share, then Add to Home Screen, and open Figmark from the new icon.';
    case 'blocked':
      return 'Notifications are blocked for this site. Allow them in your settings to get them here.';
    case 'on':
      return 'Notifications are on for this device.';
    case 'off':
      return 'Get these on your lock screen, even when Figmark is closed.';
    case 'unavailable':
      return 'Notifications are not set up on this site yet.';
    case 'unsupported':
      return 'This browser cannot show notifications from Figmark.';
  }
}

function Buttons({ push, quiet }: { push: Push; quiet?: boolean }) {
  if (push.state === 'on') {
    return (
      <span className="bell__push-actions">
        <button type="button" className={quiet ? 'btn btn--quiet btn--sm' : 'btn btn--sm'} onClick={() => void push.sendTest()}>
          Send a test
        </button>
        <button type="button" className="btn btn--quiet btn--sm" disabled={push.busy} onClick={() => void push.turnOff()}>
          Turn off
        </button>
      </span>
    );
  }
  if (push.state === 'off') {
    return (
      <button type="button" className="btn btn--sm" disabled={push.busy} onClick={() => void push.turnOn()}>
        {push.busy ? 'Turning on…' : 'Turn on'}
      </button>
    );
  }
  return null;
}

/** The row at the top of the bell. Silent where this browser or site cannot do it. */
export function PushRow({ push }: { push: Push }) {
  if (!push.state || push.state === 'unsupported' || push.state === 'unavailable') return null;
  return (
    <div className="bell__push">
      <span className={push.state === 'off' || push.state === 'needs-install' ? undefined : 'faint'}>{explain(push.state)}</span>
      <Buttons push={push} quiet />
    </div>
  );
}

/** A card for the profile page. Always says where things stand, so a missing notification can be explained. */
export function PushCard() {
  const push = usePush();
  if (!push.state) return null;
  return (
    <section className="card card--pad stack" style={{ marginBottom: 18 }}>
      <span className="card__title">Notifications on this device</span>
      <div className="row row--between" style={{ gap: 12, alignItems: 'center' }}>
        <span className={push.state === 'on' ? 'faint' : undefined}>{explain(push.state)}</span>
        <Buttons push={push} />
      </div>
    </section>
  );
}
