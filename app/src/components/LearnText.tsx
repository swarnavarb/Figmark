import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Guide text, drawn from the three bits of formatting the Learn editor allows.
 *
 * A blank line is a new paragraph, a line starting "- " is a bullet, and
 * **double stars** are bold. [text](/path) is a link: a path inside the app
 * becomes an in-app link, an https address opens in a new tab, and anything
 * else is shown as plain text. No HTML is ever interpreted, so whatever an
 * operator types cannot run in a reader's browser.
 */
export function LearnText({ text, inRouter = true }: { text: string; inRouter?: boolean }) {
  if (!text.trim()) return null;
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="learntext">
      {blocks.map((block, index) => {
        const lines = block.split('\n').filter((line) => line.trim());
        if (lines.length > 0 && lines.every((line) => /^\s*[-•]\s+/.test(line))) {
          return (
            <ul key={index}>
              {lines.map((line, at) => <li key={at}>{inline(line.replace(/^\s*[-•]\s+/, ''), inRouter)}</li>)}
            </ul>
          );
        }
        // A paragraph that starts with bullets and carries on as text still reads right.
        return (
          <p key={index}>
            {lines.map((line, at) => (
              <Fragment key={at}>{at > 0 && <br />}{inline(line, inRouter)}</Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inline(line: string, inRouter: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) out.push(line.slice(last, match.index));
    if (match[1] !== undefined) {
      out.push(<strong key={key++}>{match[1]}</strong>);
    } else {
      const label = match[2] ?? '';
      const href = match[3] ?? '';
      if (/^\/(?!\/)/.test(href)) {
        out.push(inRouter ? <Link key={key++} to={href}>{label}</Link> : <a key={key++} href={href}>{label}</a>);
      } else if (/^https:\/\//.test(href)) {
        out.push(<a key={key++} href={href} target="_blank" rel="noreferrer noopener">{label}</a>);
      } else {
        out.push(label);
      }
    }
    last = pattern.lastIndex;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}
