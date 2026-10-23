/**
 * One human step, sent to the running driver.
 *
 *   node .claude/skills/qa-buy-sell/driver/act.mjs <persona> <command> [args...]
 *
 *   act.mjs meera login meera@figmark.in figmark123
 *   act.mjs meera open /discover
 *   act.mjs meera click "Buy now"
 *   act.mjs meera click @12
 *   act.mjs arjun type "Price (₹)" 1450
 *   act.mjs arjun choose Lot "Add to a lot later"
 *   act.mjs meera expect "Waiting on the seller"
 *   act.mjs meera shot after-pay
 *   act.mjs meera errors
 *
 * Add --desktop before the persona to give a new persona a desktop screen.
 */
const port = Number(process.env.QA_DRIVER_PORT ?? 9333);
let argv = process.argv.slice(2);
let device;
if (argv[0] === '--desktop') { device = 'desktop'; argv = argv.slice(1); }
const [persona, command, ...args] = argv;
if (!persona || !command) {
  console.error('usage: act.mjs [--desktop] <persona> <command> [args...]');
  process.exit(2);
}
try {
  const res = await fetch(`http://127.0.0.1:${port}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ persona, command, args, device }),
  });
  console.log(await res.text());
} catch {
  console.error(`No driver on :${port}. Start it: node .claude/skills/qa-buy-sell/driver/server.mjs`);
  process.exit(1);
}
