import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LearnDoc, LearnTab } from '@shared/learn';
import { ApiRequestError, api } from '../api';
import { SkeletonText } from '../components/Feedback';
import { LearnText } from '../components/LearnText';
import { Lightbox } from '../components/SocialPost';
import { ErrorNotice } from '../components/ui';

/**
 * Learn: how to use Figmark, one side tab per part of the app.
 *
 * The content is written by the operators in the admin console (with a full
 * guide shipped as the default), so this page only draws it: a rail of tabs
 * down the side, then the chosen tab's sections, each with numbered steps and
 * a picture where one helps. The chosen tab lives in the URL so a link can
 * open straight onto it.
 */
export function LearnPage() {
  const [params, setParams] = useSearchParams();
  const [doc, setDoc] = useState<LearnDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ url: string; title: string; caption: string } | null>(null);

  useEffect(() => {
    void api.learn()
      .then(setDoc)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the guide.'));
  }, []);

  if (error) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!doc) return <main className="page"><SkeletonText lines={8} /></main>;

  const asked = params.get('tab');
  const tab: LearnTab | undefined = doc.tabs.find((entry) => entry.id === asked) ?? doc.tabs[0];
  if (!tab) return <main className="page"><p className="muted">Nothing to learn here yet.</p></main>;

  const choose = (id: string) => {
    setParams({ tab: id }, { replace: true });
    window.scrollTo({ top: 0 });
  };

  return (
    <main className="page learn">
      <nav className="learn__rail" aria-label="Guide sections">
        <p className="learn__railhead">Learn</p>
        {doc.tabs.map((entry) => (
          <button key={entry.id} type="button" aria-current={entry.id === tab.id ? 'page' : undefined}
            className={`learn__tab${entry.id === tab.id ? ' is-on' : ''}`} onClick={() => choose(entry.id)}>
            <span className="learn__icon" aria-hidden="true">{entry.icon}</span>
            <span className="learn__label">{entry.title}</span>
          </button>
        ))}
      </nav>

      <article className="learn__body">
        <header className="learn__head">
          <span className="learn__bigicon" aria-hidden="true">{tab.icon}</span>
          <div>
            <h1>{tab.title}</h1>
            {tab.intro && <p className="learn__intro">{tab.intro}</p>}
          </div>
        </header>

        {tab.sections.length > 1 && (
          <nav className="learn__toc" aria-label="In this guide">
            <b>In this guide</b>
            <ol>
              {tab.sections.map((section) => (
                <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
              ))}
            </ol>
          </nav>
        )}

        {tab.sections.map((section) => (
          <section key={section.id} id={section.id} className="learn__section">
            <h2>{section.title}</h2>
            <LearnText text={section.body} />
            {section.steps.length > 0 && (
              <ol className="learn__steps">
                {section.steps.map((entry, index) => (
                  <li key={index} className="learn__step">
                    <span className="learn__num" aria-hidden="true">{index + 1}</span>
                    <div className="learn__stepbody">
                      <h3>{entry.title}</h3>
                      <LearnText text={entry.body} />
                      {entry.image && (
                        <figure className="learn__figure">
                          <button type="button" className="learn__shot"
                            onClick={() => setPhoto({ url: entry.image!, title: entry.title, caption: entry.caption })}
                            aria-label={`Enlarge the picture for ${entry.title}`}>
                            <img src={entry.image} alt={entry.caption || entry.title} loading="lazy" />
                          </button>
                          {entry.caption && <figcaption>{entry.caption}</figcaption>}
                        </figure>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}

        {doc.updatedAt && <p className="faint learn__updated">Last updated {new Date(doc.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>}
      </article>

      {photo && (
        <Lightbox photos={[photo.url]} start={0} onClose={() => setPhoto(null)} title={photo.title} caption={photo.caption} />
      )}
    </main>
  );
}
