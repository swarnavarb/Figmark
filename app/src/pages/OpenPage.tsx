import { BackLink } from '../components/ScrollManager';
import { OpenBusinessChooser } from '../components/OpenBusiness';

/** /open - open another business on this account: a store, a forwarder, a studio. */
export function OpenPage() {
  return (
    <main className="page">
      <BackLink to="/me" title="Open a business" />
      <div className="page__head"><div><p className="muted">Pick what you want to run. You can open more than one.</p></div></div>
      <OpenBusinessChooser />
    </main>
  );
}
