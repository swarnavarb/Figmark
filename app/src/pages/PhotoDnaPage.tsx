import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { DnaSummary } from '@shared/dna';
import { ApiRequestError, api, type PhotoBox, type PhotoSalesResponse } from '../api';
import { BackLink } from '../components/ScrollManager';
import { CropPic, DnaHelix, dnaHref, sequenceOf } from '../components/DnaKit';
import { Icon } from '../components/Icon';
import { SalesDetails, type PhotoPoster } from '../components/PhotoSales';
import { PageError } from '../components/ui';
import { formatMoney } from '../format';
import { useSession } from '../session';
import '../styles/PhotoDnaPage.css';

/**
 * A photo's Product DNA: what every Product DNA button under a photo opens.
 *
 * The photo is read the way image search and the sell form read one - what
 * Claude names, and whatever stands off the backdrop - and each thing in it
 * is numbered on the photo, cut out of it below, and followed to its own
 * product's page when Figmark has one. Under them, everything about where the
 * things can be had: on sale now, sold before, probable matches, the shops
 * likely to get them, and a quick question to whoever posted it.
 */

interface Thing {
  key: string;
  /** Its place in the photo; null for one only the words with the photo named. */
  box: PhotoBox | null;
  label: string | null;
  dna: DnaSummary | null;
  /** Listings it matched, on sale now. */
  live: number;
}

function thingsOf(sales: PhotoSalesResponse): Thing[] {
  // Each thing comes with its product when the page asked for them; the
  // matches that found it say how many are on sale when it has none.
  return (sales.things ?? []).map((thing, at) => {
    const group = thing.dna === undefined ? sales.items.find((item) => item.thing === at) : undefined;
    return {
      key: `t${at}`,
      box: thing.boxes[0] ?? null,
      label: thing.label,
      dna: thing.dna !== undefined ? thing.dna : group?.dna ?? null,
      live: group?.listings.filter((listing) => listing.onSale).length ?? 0,
    };
  });
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function PhotoDnaPage() {
  const [params] = useSearchParams();
  const url = params.get('u') ?? '';
  const about = params.get('a') ?? '';
  const by = params.get('b') ?? '';
  const posterName = params.get('pn');
  const posterHandle = params.get('ph');
  const { user } = useSession();
  const poster: PhotoPoster | null = posterName && posterHandle && user?.id !== by
    ? { name: posterName, handle: posterHandle, link: params.get('pl') ?? undefined }
    : null;

  const [sales, setSales] = useState<PhotoSalesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [lit, setLit] = useState<string | null>(null);

  useEffect(() => {
    if (!url) { setError('No photo to read.'); return; }
    let live = true;
    setSales(null);
    setError(null);
    void api.photoDna(url, about || undefined, by || undefined).then(
      (found) => { if (live) setSales(found); },
      (err) => { if (live) setError(err instanceof ApiRequestError ? err.message : 'Could not read this photo.'); },
    );
    return () => { live = false; };
  }, [url, about, by]);

  const title = <span className="pdnap__backtitle"><Icon name="dna" size={15} /> Product DNA</span>;
  if (error) return <main className="page"><BackLink to="/discover?lens=products" title={title} /><PageError message={error} /></main>;

  const things = sales ? thingsOf(sales) : [];
  const placed = things.filter((thing) => thing.box);
  // Named, or with a product: a row each. Things only seen, with nothing to go on: a strip of cut-outs.
  const rows = things.filter((thing) => thing.dna || thing.label || thing.live > 0);
  const loose = things.filter((thing) => !rows.includes(thing));
  const own = sales?.own ?? [];
  const named = things.filter((thing) => thing.dna).length;

  return (
    <main className="page pdnap">
      <BackLink to="/discover?lens=products" title={title} />

      <header className="pdnap__hero">
        <div className="pdnap__photo" style={ratio ? { aspectRatio: String(ratio), width: `min(100%, calc(58vh * ${ratio}))` } : undefined}>
          <img src={url} alt="The photo" decoding="async"
            onLoad={(event) => setRatio(event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight))} />
          {!sales && <span className="pdnap__scan" aria-hidden="true" />}
          {placed.map((thing, at) => {
            const [left, top, width, height] = thing.box!;
            return (
              <a key={thing.key} href={`#${thing.key}`} className={`pdnap__mark${thing.dna ? ' has-dna' : ''}${lit === thing.key ? ' is-lit' : ''}`}
                style={{ left: `${(left + width / 2) * 100}%`, top: `${(top + height / 2) * 100}%`, ['--i' as string]: Math.min(at, 20) } as CSSProperties}
                aria-label={`${at + 1}: ${thing.dna?.name ?? thing.label ?? 'a thing'}`}
                onClick={(event) => {
                  event.preventDefault();
                  setLit(thing.key);
                  document.getElementById(thing.key)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}>
                {at + 1}
              </a>
            );
          })}
          {lit && placed.find((thing) => thing.key === lit) && (() => {
            const [left, top, width, height] = placed.find((thing) => thing.key === lit)!.box!;
            return <span className="pdnap__box" style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }} />;
          })()}
        </div>
        <div className="pdnap__herotext">
          <p className="pdnap__eyebrow"><DnaHelix rungs={5} still /> Product DNA of a photo</p>
          <h1 className="pdnap__title">
            {!sales ? 'Reading the photo…'
              : things.length === 0 ? 'Nothing named in this photo yet'
                : things.length === 1 ? (things[0]!.dna?.name ?? capital(things[0]!.label ?? 'One thing'))
                  : `${things.length} things in this photo`}
          </h1>
          {sales && (
            <p className="pdnap__lede">
              {things.length > 1 && `${named} of them ${named === 1 ? 'has' : 'have'} a Product DNA. `}
              {about && <span className="pdnap__about">“{about.length > 120 ? `${about.slice(0, 117)}…` : about}”</span>}
            </p>
          )}
        </div>
      </header>

      {!sales && (
        <div className="pdnap__things" aria-hidden="true">
          {Array.from({ length: 4 }, (_, at) => <span key={at} className="pdnap__ghost" />)}
        </div>
      )}

      {rows.length > 0 && (
        <section className="pdnap__section" aria-labelledby="pdnap-things">
          <h2 id="pdnap-things" className="pdnap__h2">In this photo</h2>
          <ol className="pdnap__things">
            {rows.map((thing, at) => {
              const number = thing.box ? placed.indexOf(thing) + 1 : null;
              const name = thing.dna?.name ?? (thing.label ? capital(thing.label) : `Thing ${number ?? at + 1}`);
              const body = (
                <>
                  <span className="pdnap__pic">
                    {thing.box ? <CropPic src={url} box={thing.box} />
                      : thing.dna?.cover ? <CropPic src={thing.dna.cover} box={thing.dna.coverBox} />
                        : <DnaHelix rungs={6} still />}
                    {number !== null && <span className="pdnap__num">{number}</span>}
                  </span>
                  <span className="pdnap__thingtext">
                    {thing.dna && <span className="pdnap__seq">{sequenceOf(thing.dna.id)}</span>}
                    <b>{name}</b>
                    {thing.dna ? (
                      <span className="pdnap__meta">
                        {thing.dna.lowMinor !== null ? <em>{formatMoney(thing.dna.lowMinor, thing.dna.currency)}</em> : 'Not on sale now'}
                        {' · '}{thing.dna.sellers === 1 ? '1 shop' : `${thing.dna.sellers} shops`}
                        {thing.dna.rating !== null && ` · ★ ${thing.dna.rating.toFixed(1)}`}
                      </span>
                    ) : (
                      <span className="pdnap__meta">{thing.live > 0 ? `${thing.live} for sale` : 'Not on Figmark yet'}</span>
                    )}
                  </span>
                  {thing.dna && <Icon name="right" size={16} />}
                </>
              );
              return (
                <li key={thing.key} id={thing.key} className={lit === thing.key ? 'is-lit' : undefined}
                  style={{ ['--i' as string]: Math.min(at, 12) } as CSSProperties}
                  onMouseEnter={() => thing.box && setLit(thing.key)}>
                  {thing.dna
                    ? <Link to={dnaHref(thing.dna.id)} className="pdnap__thing has-dna">{body}</Link>
                    : <div className="pdnap__thing">{body}</div>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {loose.length > 0 && (
        <section className="pdnap__section" aria-labelledby="pdnap-loose">
          <h2 id="pdnap-loose" className="pdnap__h2">
            {rows.length > 0 ? `${loose.length} more in the photo` : `${loose.length} things in the photo`}
            <small className="pdnap__h2note">Not on Figmark yet</small>
          </h2>
          <ol className="pdnap__loose">
            {loose.map((thing) => (
              <li key={thing.key} id={thing.key} className={lit === thing.key ? 'is-lit' : undefined}>
                <button type="button" className="pdnap__loosepic"
                  onClick={() => { setLit(thing.key); document.querySelector('.pdnap__photo')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
                  aria-label={`Thing ${placed.indexOf(thing) + 1}: show where it is`}>
                  {thing.box && <CropPic src={url} box={thing.box} />}
                  <span className="pdnap__num">{placed.indexOf(thing) + 1}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {sales && (own.length > 0 || poster || sales.items.length > 0 || sales.sellers.length > 0
        || sales.probable.length > 0 || sales.likely.length > 0) && (
        <section className="pdnap__section pdnap__where" aria-labelledby="pdnap-where">
          <h2 id="pdnap-where" className="pdnap__h2">Where to get {things.length > 1 ? 'them' : 'it'}</h2>
          <SalesDetails sales={sales} poster={own.length === 0 ? poster : null} by={by} />
        </section>
      )}
    </main>
  );
}
