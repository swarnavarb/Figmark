/**
 * The leaderboard and quest rules, checked as plain functions.
 *
 * Hobby boards: every listing category sits on exactly one broad board, old
 * board ids land on the board they became, and ties share a place. Top
 * players: only the games count, in their season, and votes stop paying at the
 * cap. Quests: no two picks ask for the same thing, nobody is asked to review
 * before anything has arrived, finished quests nobody tapped are collected,
 * and a missed day can be saved once.
 */
import assert from 'node:assert/strict';

const dist = (path) => new URL(`../api/dist/${path}`, import.meta.url);
const boards = await import(dist('shared/boards.js'));
const quest = await import(dist('shared/quest.js'));
const { CATEGORIES } = await import(dist('shared/catalog.js'));
const { VOTE_POINTS_CAP } = await import(dist('shared/play.js'));
const { leaderboardOf } = await import(dist('api/src/play.js'));

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('hobby boards');

check('every listing category is on exactly one board', () => {
  for (const category of CATEGORIES) {
    const on = boards.BOARD_CATEGORIES.filter((board) => board.members.includes(category));
    assert.equal(on.length, 1, `${category} is on ${on.length} boards`);
  }
});

check('the boards are broad: action figures and sneakers among them', () => {
  const labels = boards.categoryBoards().map((board) => board.label);
  assert.ok(labels.includes('Action figures'));
  assert.ok(labels.includes('Sneakers'));
  assert.ok(labels.length <= 12, 'a handful of boards, not one per hobby');
});

check('old ids land on the board they became; made-up hobbies are gone', () => {
  assert.equal(boards.currentBoardId('cat:wear'), 'cat:sneakers');
  assert.equal(boards.currentBoardId('tag:gunpla'), 'cat:models');
  assert.equal(boards.currentBoardId('tag:nendoroid'), 'cat:figures');
  assert.equal(boards.currentBoardId('tag:pokemon-tcg'), 'cat:cards');
  assert.equal(boards.currentBoardId('tag:rude-word-board'), null);
  assert.deepEqual(boards.currentBoards(['tag:gunpla', 'cat:models', 'tag:xyz', 'cat:wear']), ['cat:models', 'cat:sneakers']);
  assert.equal(boards.boardInfo('tag:anything-at-all'), null);
});

check('an item is on a board by its category, a post by its item or hashtag', () => {
  assert.ok(boards.listingOnBoard('cat:figures', { category: 'Collectibles' }));
  assert.ok(!boards.listingOnBoard('cat:figures', { category: 'Sneakers' }));
  assert.ok(boards.postOnBoard('cat:models', { body: 'New #gunpla build' }, null));
  assert.ok(boards.postOnBoard('cat:sneakers', { body: 'Fresh #kicks today' }, null));
  assert.ok(!boards.postOnBoard('cat:sneakers', { body: 'no tags here' }, null));
  assert.equal(boards.boardForHobby('Gundam kits'), 'cat:models');
});

check('a tie shares a place, and the podium takes everybody on it', () => {
  const row = (userId, points, delivered) => ({ userId, points, delivered, collected: 0, reviews: 0, posts: 0 });
  const ranked = boards.rankRows([row('a', 30, 2), row('b', 20, 1), row('c', 20, 1), row('d', 10, 1), row('e', 0, 0)]);
  assert.deepEqual(ranked.map((entry) => [entry.userId, entry.rank]), [['a', 1], ['b', 2], ['c', 2], ['d', 4]]);
  assert.deepEqual(boards.podiumOf(ranked).map((entry) => entry.userId), ['a', 'b', 'c']);
  const gap = boards.gapFor(ranked, 'd');
  assert.deepEqual(gap, { rank: 4, aheadRank: 2, points: 10 });
  assert.equal(boards.gapFor(ranked, 'a'), null);
});

check('a stored score keeps only seasons with points', () => {
  const now = Date.parse('2026-11-14T10:00:00+05:30');
  const stored = boards.storedScore({ delivered: ['2026-11-02T10:00:00+05:30'], collected: [], reviews: [], posts: ['2026-09-03T10:00:00+05:30'] }, now);
  assert.deepEqual(Object.keys(stored.seasons).sort(), ['2026-09', '2026-11']);
  assert.equal(stored.seasons['2026-11'].points, boards.BOARD_POINTS.delivered);
});

console.log('\ntop players');

check('only games count, in their season, and votes stop paying at the cap', () => {
  const voters = Array.from({ length: 5 }, (_, index) => `u${index}`);
  const debate = (id, createdAt, voterIds) => ({
    id, createdAt, debate: { listingIds: [null, null] },
    poll: { closesAt: createdAt, options: [{ id: 'a', label: 'A', voterIds }, { id: 'b', label: 'B', voterIds: [] }] },
  });
  const posts = [
    // An ordinary poll: not a game, worth nothing.
    { id: 'poll', createdAt: '2026-11-03T10:00:00+05:30', poll: { closesAt: null, options: [{ id: 'a', label: 'A', voterIds: ['u0'] }] } },
    // Last month's debate: not this season.
    debate('old', '2026-10-20T10:00:00+05:30', ['u1']),
    // Lots of this season's debates, all voted by u0.
    ...Array.from({ length: VOTE_POINTS_CAP + 10 }, (_, index) => debate(`d${index}`, '2026-11-05T10:00:00+05:30', [voters[0]])),
    { id: 'win', createdAt: '2026-10-28T10:00:00+05:30', contest: {
      settledAt: '2026-11-02T10:00:00+05:30', endsAt: '2026-11-01T10:00:00+05:30',
      winners: [{ place: 1, userId: 'u2', entryId: 'e', name: 'U2', photoUrl: '', votes: 3 }],
    } },
  ];
  const rows = leaderboardOf(posts, '2026-11');
  assert.equal(rows.get('u0').points, VOTE_POINTS_CAP, 'vote points stop at the cap');
  assert.equal(rows.get('u0').votes, VOTE_POINTS_CAP + 10, 'votes are still shown');
  assert.equal(rows.get('u1'), undefined, 'last month does not count');
  assert.equal(rows.get('u2').wins, 1, 'a win counts when it was settled');
});

console.log('\nquests');

const facts = (over = {}) => ({
  orders: [], reviewsWritten: [], ratingsReceived: [], pageRatings: [], likes: [], follows: [], posts: [], wants: { total: 0, week: '', inWeek: 0, month: '', inMonth: 0 },
  pledges: 0, disputesLost: 0, collection: [], hasBio: false, hasTags: false, shares: 0, referredSales: 0,
  shareOpens: [], sharesSent: [], invites: [], invitedSellers: 0, ...over,
});
const at = (day) => Date.parse(`${day}T10:00:00+05:30`);

check('no two of a period\'s picks ask for the same thing', () => {
  const delivered = Array.from({ length: 10 }, () => ({ createdAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-02T00:00:00Z', status: 'delivered', totalMinor: 100, preOrder: false }));
  for (let day = 1; day <= 120; day += 1) {
    const now = Date.parse('2026-07-01T10:00:00+05:30') + day * 86_400_000;
    const view = quest.questView('u', facts({ orders: delivered }), undefined, now);
    for (const kind of ['daily', 'weekly', 'monthly']) {
      const titles = view.tasks.filter((task) => task.kind === kind).map((task) => task.title);
      const saves = titles.filter((title) => /^Save /.test(title));
      assert.ok(saves.length <= 1, `two save quests on ${kind}: ${titles.join(', ')}`);
      const orders = titles.filter((title) => /order/i.test(title) && !/pre-order/i.test(title));
      assert.ok(orders.length <= 1, `two order quests on ${kind}: ${titles.join(', ')}`);
    }
  }
});

check('nobody is asked to review or shelve before anything has arrived', () => {
  for (let day = 1; day <= 60; day += 1) {
    const view = quest.questView('u', facts(), undefined, at('2026-08-01') + day * 86_400_000);
    const periodic = view.tasks.filter((task) => ['daily', 'weekly', 'monthly'].includes(task.kind));
    assert.ok(!periodic.some((task) => /review|collect|detail/.test(task.id)), periodic.map((task) => task.id).join(', '));
  }
});

check('a leaderboard quest: join one, and climb one every month', () => {
  const view = quest.questView('u', facts(), undefined, at('2026-11-14'));
  const contender = view.tasks.find((task) => task.id === 'ms-boards-1');
  assert.ok(contender, 'Contender I is on the milestones');
  assert.equal(contender.done, false);
  const monthly = view.tasks.find((task) => task.id === 'monthly-board10');
  assert.ok(monthly, 'Climb a leaderboard is a monthly quest');
  const on = quest.questView('u', facts({ boards: 1, boardPoints: { '2026-11': 10 } }), undefined, at('2026-11-14'));
  assert.ok(on.tasks.find((task) => task.id === 'ms-boards-1').claimable);
  assert.ok(on.tasks.find((task) => task.id === 'monthly-board10').claimable);
});

check('a podium is worth XP', () => {
  const none = quest.questView('u', facts(), undefined, at('2026-11-14')).xp;
  const one = quest.questView('u', facts({ podiums: 1 }), undefined, at('2026-11-14')).xp;
  assert.equal(one - none, quest.XP.podium);
});

check('a quest finished yesterday and never tapped is collected, once', () => {
  const sent = facts({ sharesSent: [{ createdAt: '2026-11-13T09:00:00+05:30', kind: 'item' }] });
  const now = at('2026-11-14');
  const first = quest.autoCollect(sent, undefined, now);
  assert.ok(first.collected.some((task) => task.taskId === 'daily-share1'), JSON.stringify(first.collected));
  assert.ok(first.state.claimed['daily-share1:2026-11-13']);
  const again = quest.autoCollect(sent, first.state, now);
  assert.equal(again.collected.length, 0);
  const before = quest.questView('u', sent, undefined, now).xp;
  const after = quest.questView('u', sent, first.state, now).xp;
  assert.ok(after > before, 'the collected reward pays');
});

check('a missed day can be saved with a bump point, once a month, for the streak only', () => {
  const state = { checkIns: ['2026-11-10', '2026-11-11', '2026-11-12'], claimed: {}, reveals: [], bumps: 1 };
  const now = at('2026-11-14');
  const offer = quest.streakRepairFor(state, now);
  assert.equal(offer.day, '2026-11-13');
  assert.equal(offer.affordable, true);
  assert.equal(offer.saves, 4);
  const saved = { ...state, checkIns: [...state.checkIns, offer.day], repairs: [offer.day], bumps: 0 };
  const view = quest.questView('u', facts(), saved, now);
  assert.equal(view.streak.current, 4);
  assert.equal(quest.streakRepairFor({ ...saved, checkIns: [...saved.checkIns, '2026-11-14'] }, at('2026-11-16')), null, 'one save a month');
  const plain = quest.questView('u', facts(), state, now).xp;
  assert.equal(view.xp, plain, 'a saved day pays no check-in XP');
  assert.equal(quest.streakRepairFor({ ...state, bumps: 0 }, now).affordable, false);
});

check('a claim at the turn of the day is stored under the day it was checked on', () => {
  const late = Date.parse('2026-11-14T23:59:59.900+05:30');
  assert.equal(quest.claimKey('daily-share1', late), 'daily-share1:2026-11-14');
});

console.log(`\n${passed} checks passed`);
