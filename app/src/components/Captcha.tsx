import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile, drawn only when the server asks for it (a site key in
 * /api/health). Its script is fetched the first time a sign-up form needs it.
 */
interface Turnstile {
  render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; theme: 'dark' }) => string;
  remove: (id: string) => void;
}

let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => {
      const api = (window as unknown as { turnstile?: Turnstile }).turnstile;
      if (api) resolve(api); else reject(new Error('Turnstile did not load.'));
    };
    script.onerror = () => { loading = null; reject(new Error('Turnstile did not load.')); };
    document.head.appendChild(script);
  });
  return loading;
}

export function Captcha({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id: string | null = null;
    let live = true;
    void loadTurnstile().then((turnstile) => {
      if (!live || !box.current) return;
      id = turnstile.render(box.current, {
        sitekey: siteKey, theme: 'dark', callback: (token) => onToken(token), 'expired-callback': () => onToken(null),
      });
    }).catch(() => onToken(null));
    return () => {
      live = false;
      if (id) void loadTurnstile().then((turnstile) => turnstile.remove(id!)).catch(() => undefined);
    };
  }, [siteKey, onToken]);
  return <div ref={box} className="auth__captcha" />;
}
