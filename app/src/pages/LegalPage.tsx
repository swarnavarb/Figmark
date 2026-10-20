import { Link, Navigate, useParams } from 'react-router-dom';
import { LEGAL_DOCS, LEGAL_VERSION } from '../legal';
import '../styles/LegalPage.css';

/** One policy, or the list of them at /legal. */
export function LegalPage() {
  const { doc: slug } = useParams();
  const doc = slug ? LEGAL_DOCS.find((entry) => entry.slug === slug) : null;
  if (slug && !doc) return <Navigate to="/legal" replace />;

  return (
    <main className="page policy">
      <p className="notice notice--warn policy__draft">
        Draft for legal review (version {LEGAL_VERSION}). Not yet final, and values in [brackets] are still to be filled in.
      </p>
      {doc ? (
        <article className="stack">
          <Link to="/legal" className="policy__back">← Policies</Link>
          <h1>{doc.title}</h1>
          <p className="muted">{doc.summary}</p>
          {doc.sections.map((section) => (
            <section key={section.heading} className="policy__section">
              <h2>{section.heading}</h2>
              {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}
        </article>
      ) : (
        <div className="stack">
          <h1>Policies</h1>
          <ul className="policy__list">
            {LEGAL_DOCS.map((entry) => (
              <li key={entry.slug}>
                <Link to={`/legal/${entry.slug}`}><strong>{entry.title}</strong></Link>
                <span className="faint">{entry.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
