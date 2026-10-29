/**
 * The demo world the tests and the local server run against: accounts with a
 * password published here, their shops, lots, orders and posts.
 *
 * Kept out of the API on purpose. Nothing under api/ imports this, so no
 * build that reaches Azure can carry it, and no database there can be filled
 * with it. A test builds the in-memory store from fixtureSet().
 */
import type { Fixtures } from '../api/src/data/memory-repository.js';
import {
  ARTIST_EMAIL, DEMO_EMAIL, DEMO_PASSWORD, DEMO_PHONE, FORWARDER_EMAIL, HANDLER_EMAIL, MANAGER_EMAIL, PACKER_EMAIL,
  seedComments, seedDisputes, seedFollows, seedForums, seedLikes, seedListings, seedLiveSale, seedLotBuyers,
  seedLotOrders, seedLots, seedOpenLot, seedOrders, seedPledges, seedPosts, seedReviews, seedShippedLot, seedUsers,
  seedWantOffers, seedWants,
} from './seed.js';
import { seedFeedDemoPosts } from './seed-feed-demo.js';
import { seedShowcaseListings, seedShowcaseLots, seedShowcaseOrders, seedShowcaseSales } from './seed-showcase.js';
import { seedTestListings } from './seed-test-catalog.js';

export * from './seed.js';
export { renewShowcaseSales } from './seed-showcase.js';

export function fixtureSet(): Fixtures {
  return {
    users: [...seedUsers(), ...seedLotBuyers()],
    routedLots: [...seedLots(), seedOpenLot(), seedShippedLot()],
    // The Buy tab's demo lots and drops, timed off the real clock.
    lots: seedShowcaseLots(),
    listings: [...seedListings(), ...seedShowcaseListings(), ...seedTestListings()],
    orders: [...seedOrders(), seedLiveSale(), ...seedLotOrders(), ...seedShowcaseOrders()],
    powerSales: seedShowcaseSales(),
    comments: seedComments(),
    likes: seedLikes(),
    follows: seedFollows(),
    forums: seedForums(),
    posts: [...seedPosts(), ...seedFeedDemoPosts()],
    reviews: seedReviews(),
    disputes: seedDisputes(),
    wants: seedWants(),
    wantOffers: seedWantOffers(),
    pledges: seedPledges(),
    // The accounts that can actually be signed into: the shop, the two people
    // who work its lots at either end of the water, and a community manager.
    demoAccounts: [
      { identifier: DEMO_EMAIL, label: `${DEMO_PHONE} · ${DEMO_PASSWORD}` },
      { identifier: PACKER_EMAIL, label: `the supplier's packing view · ${DEMO_PASSWORD}` },
      { identifier: MANAGER_EMAIL, label: `a community manager who decides disputes · ${DEMO_PASSWORD}` },
      { identifier: HANDLER_EMAIL, label: `the handler getting the parcels out · ${DEMO_PASSWORD}` },
      { identifier: FORWARDER_EMAIL, label: `the freight forwarder's store · ${DEMO_PASSWORD}` },
      { identifier: ARTIST_EMAIL, label: `the artist studio taking commissions · ${DEMO_PASSWORD}` },
    ],
  };
}
