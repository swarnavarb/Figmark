import { useEffect, useRef } from 'react';

/*
 * The arcade game that plays behind the quest board on the Quests page.
 */

/* Pixel sprites for the board's game, one string per row. */
const ALIEN_FRAMES = [
  ['..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...'],
  ['..X.....X..', 'X..X...X..X', 'X.XXXXXXX.X', 'XXX.XXX.XXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..X.....X..', '.X.......X.'],
];
const SHIP_ROWS = ['....X....', '...XXX...', '...XXX...', '.XXXXXXX.', 'XXXXXXXXX', 'XXXXXXXXX'];
const PX = 2;
const ALIEN_W = 11 * PX;
const ALIEN_H = 8 * PX;

type Alien = { slot: number; alive: boolean; back: number };
type Shot = { x: number; y: number };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; hue: string };

function drawSprite(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, colour: string) {
  ctx.fillStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 6;
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i += 1) if (row[i] === 'X') ctx.fillRect(x + i * PX, y + j * PX, PX, PX);
  });
  ctx.shadowBlur = 0;
}

/**
 * The little shooter that plays behind the quest board: a fleet shuffling
 * along the bottom strip, a ship picking targets under it. Shots that miss
 * fly on to the top of the board; one that hits blows its invader apart, and
 * the invader warps back in a moment later. Drawn on a canvas so the hits are
 * real rather than timed, and paused whenever it is off screen.
 */
export function QuestShooter({ volley = 0 }: {
  /** Goes up by one each time a quest is cleared: the ship answers with a burst of fire. */
  volley?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const burst = useRef(0);
  const seen = useRef(volley);
  useEffect(() => {
    if (volley > seen.current) burst.current += 6;
    seen.current = volley;
  }, [volley]);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const sizer = new ResizeObserver(fit);
    sizer.observe(canvas);

    const gap = 14;
    const aliens: Alien[] = Array.from({ length: 6 }, (_, slot) => ({ slot, alive: true, back: 0 }));
    const shots: Shot[] = [];
    const sparks: Spark[] = [];
    const booms: { x: number; y: number; life: number }[] = [];
    let march = 0;
    let dir = 1;
    let nextStep = 0;
    let shipX = w / 2;
    let aim = w / 2;
    let nextAim = 0;
    let nextShot = 0;
    let last = performance.now();
    let frame = 0;
    let visible = true;

    const fleetLeft = () => (w - (6 * ALIEN_W + 5 * gap)) / 2 + march;
    const alienX = (alien: Alien) => fleetLeft() + alien.slot * (ALIEN_W + gap);
    const alienY = () => h - 46;

    function blast(x: number, y: number) {
      booms.push({ x, y, life: 1 });
      const hues = ['#FDE047', '#F472B6', '#A78BFA', '#FFFFFF'];
      for (let i = 0; i < 22; i += 1) {
        const angle = (i / 22) * Math.PI * 2 + Math.random() * 0.3;
        const speed = 50 + Math.random() * 90;
        sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, hue: hues[i % hues.length] ?? '#FFFFFF' });
      }
    }

    function tick(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx!.clearRect(0, 0, w, h);

      if (now > nextStep) {
        march += dir * 6;
        if (Math.abs(march) > 54) dir = -dir;
        nextStep = now + 420;
      }
      for (const alien of aliens) if (!alien.alive && now > alien.back) alien.alive = true;

      // Half the time the ship lines up under a live invader, half it wanders.
      if (now > nextAim) {
        const live = aliens.filter((alien) => alien.alive);
        const pick = Math.random() < 0.55 ? live[Math.floor(Math.random() * live.length)] : undefined;
        aim = pick ? alienX(pick) + ALIEN_W / 2 : 20 + Math.random() * Math.max(1, w - 40);
        nextAim = now + 1200 + Math.random() * 1200;
      }
      // A cleared quest: lock onto a live invader and fire a rapid burst at it.
      if (burst.current > 0 && now > nextShot) {
        const live = aliens.filter((alien) => alien.alive);
        const target = live[Math.floor(Math.random() * live.length)];
        if (target) aim = alienX(target) + ALIEN_W / 2;
        nextAim = now + 900;
      }
      shipX += (aim - shipX) * Math.min(1, dt * (burst.current > 0 ? 9 : 2.4));
      if (now > nextShot) {
        shots.push({ x: shipX, y: h - 16 });
        if (burst.current > 0) {
          burst.current -= 1;
          nextShot = now + 90;
        } else {
          nextShot = now + 650 + Math.random() * 500;
        }
      }

      const top = alienY();
      for (let i = shots.length - 1; i >= 0; i -= 1) {
        const shot = shots[i]!;
        shot.y -= 260 * dt;
        const hit = aliens.find((alien) => alien.alive && shot.y <= top + ALIEN_H && shot.y >= top
          && shot.x >= alienX(alien) && shot.x <= alienX(alien) + ALIEN_W);
        if (hit) {
          hit.alive = false;
          hit.back = now + 2600;
          blast(alienX(hit) + ALIEN_W / 2, top + ALIEN_H / 2);
          shots.splice(i, 1);
        } else if (shot.y < -10) {
          shots.splice(i, 1);
        }
      }

      const sprite = ALIEN_FRAMES[Math.floor(now / 450) % 2]!;
      for (const alien of aliens) {
        if (alien.alive) drawSprite(ctx!, sprite, alienX(alien), top, alien.slot % 2 ? '#22D3EE' : '#A78BFA');
      }
      drawSprite(ctx!, SHIP_ROWS, shipX - 9, h - 15, '#22D3EE');

      ctx!.fillStyle = '#FDE047';
      ctx!.shadowColor = '#FDE047';
      ctx!.shadowBlur = 8;
      for (const shot of shots) ctx!.fillRect(shot.x - 1, shot.y, 2, 7);
      ctx!.shadowBlur = 0;

      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const spark = sparks[i]!;
        spark.x += spark.vx * dt;
        spark.y += spark.vy * dt;
        spark.life -= dt * 1.8;
        if (spark.life <= 0) { sparks.splice(i, 1); continue; }
        ctx!.globalAlpha = spark.life;
        ctx!.fillStyle = spark.hue;
        ctx!.fillRect(spark.x - 1.5, spark.y - 1.5, 3, 3);
      }
      // The blast: a white-hot flash and a ring that widens and fades.
      for (let i = booms.length - 1; i >= 0; i -= 1) {
        const boom = booms[i]!;
        boom.life -= dt * 2.2;
        if (boom.life <= 0) { booms.splice(i, 1); continue; }
        const grow = 1 - boom.life;
        ctx!.globalAlpha = boom.life;
        const glow = ctx!.createRadialGradient(boom.x, boom.y, 0, boom.x, boom.y, 18 * boom.life + 4);
        glow.addColorStop(0, '#FFFFFF');
        glow.addColorStop(0.4, '#FDE047');
        glow.addColorStop(1, 'rgba(244,114,182,0)');
        ctx!.fillStyle = glow;
        ctx!.beginPath();
        ctx!.arc(boom.x, boom.y, 18 * boom.life + 4, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.strokeStyle = '#F472B6';
        ctx!.lineWidth = 2;
        ctx!.beginPath();
        ctx!.arc(boom.x, boom.y, 6 + grow * 26, 0, Math.PI * 2);
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;

      if (visible && !still) frame = requestAnimationFrame(tick);
    }

    const watcher = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = Boolean(entry?.isIntersecting) && !document.hidden;
      if (visible && !was && !still) { last = performance.now(); frame = requestAnimationFrame(tick); }
    });
    watcher.observe(canvas);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); sizer.disconnect(); watcher.disconnect(); };
  }, []);
  return <canvas ref={ref} className="qworld__game" />;
}
