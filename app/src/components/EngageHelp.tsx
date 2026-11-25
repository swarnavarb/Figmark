import type { ReactNode } from 'react';
import { Modal } from './ui';

/**
 * What each Engage card is, in plain words: what it does, when to use it, an
 * example, and anything to know first. Spread the word also gets a side-by-side
 * with affiliate commission, because the two are easy to mix up.
 */
export interface EngageHelpText {
  what: string;
  when: string[];
  example: string;
  tips?: string[];
}

export const ENGAGE_HELP: Record<string, EngageHelpText> = {
  contest: {
    what: 'People send photos to join. For example, photos of their collection or their setup. When entries close, you pick the winners, or people vote for the best photo. You give the winners store credit as a prize.',
    when: [
      'You want many people to post about your shop at the same time.',
      'You want fresh photos of your items being used by real buyers.',
      'You have a festival, a sale or a new theme coming up.',
    ],
    example: '“Show us your best shelf. Best photo wins ₹500 store credit.”',
    tips: [
      'You choose how long entries stay open and how long voting runs.',
      'The prize is store credit. Winners can spend it only at your shop.',
    ],
  },
  guess: {
    what: 'You show an item and people guess its price. Nobody can see other guesses until the reveal time. Then the real price shows, and the closest guess wins (or you pick the winner).',
    when: [
      'You have a new or rare item and want people to look at it closely.',
      'You want a fun game before you list or sell an item.',
      'Your followers are quiet and you want them to take part.',
    ],
    example: '“Guess the price of this rare model. Closest guess wins ₹250 credit.”',
    tips: [
      'A prize is optional. The game works without one.',
      'You can have more than one winner.',
    ],
  },
  poll: {
    what: 'You ask a question with a few answers and people vote. You can give a small store credit to everyone who voted for the answer that wins.',
    when: [
      'You want to know what your buyers like.',
      'You need help choosing between two or more things.',
      'You want a quick and easy way for people to take part.',
    ],
    example: '“Which colour should we bring next: red, blue or black?”',
    tips: [
      'Answers can be text, photos, two sides (versus) or a star rating.',
      'The reward for voters is optional. You set the amount and the limit.',
    ],
  },
  stock: {
    what: 'A poll about what to sell next. Buyers vote for the item they want. When you list the winning item, the people who voted for it get first chance to buy it for 24 hours.',
    when: [
      'You are not sure which item to buy for your shop next.',
      'You want to buy stock that you already know will sell.',
      'You want to thank buyers for telling you what they want.',
    ],
    example: '“What should we stock next? Model A, Model B or Model C?”',
    tips: [
      'Results show on this screen. Press “List it” next to an answer to sell it.',
    ],
  },
  debate: {
    what: 'You give two sides of a question. People pick a side and write why. The best argument wins store credit. You pick the winner, or the one with the most likes wins.',
    when: [
      'You want long, thoughtful comments, not just votes.',
      'There is a hot topic your buyers love to argue about.',
      'You want to reward people for good ideas.',
    ],
    example: '“Old models or new models: which is better? Best argument wins ₹500 credit.”',
  },
  versus: {
    what: 'The same as a debate, but with no prize. People pick a side and write why. It is just for fun.',
    when: [
      'You want people talking but do not want to give a prize.',
      'The question is light and fun.',
    ],
    example: '“Box on or box off: how do you keep your collection?”',
  },
  question: {
    what: 'You ask one question. People write their own answers below. There are no fixed choices.',
    when: [
      'You want to hear ideas in people’s own words.',
      'You want feedback on your shop, prices or delivery.',
      'You want to know if an item is real or fake, or what it is.',
    ],
    example: '“What would make you buy from us more often?”',
  },
  compare: {
    what: 'You post two photos, before and after. People drag a line across the picture to see the change.',
    when: [
      'You fixed, cleaned or painted an item.',
      'You want to show the quality of your work.',
      'You want to show how an item looks new next to old.',
    ],
    example: 'A rusty old car before cleaning, and the same car shining after.',
  },
  photo: {
    what: 'You post photos and tag each item in them. People tap a tag to see the item and buy it.',
    when: [
      'New stock has arrived and you want to show it all in one post.',
      'You have one photo with many items in it.',
      'You want people to buy straight from a photo.',
    ],
    example: 'One photo of a new box with every item in it tagged.',
  },
  spread: {
    what: 'You ask your buyers to bring NEW people to Figmark. Each person who shares gets their own link. When someone new makes a Figmark account through that link (and checks their phone number) while it is running, the sharer earns store credit from you. The new person does not have to buy anything.',
    when: [
      'You want MORE people in your shop, not just more sales.',
      'A live drop is coming and you want a full room. Run it before the drop.',
      'Your shop is new and you need your first followers fast.',
      'Items are left after a drop and you want new people to see them.',
    ],
    example: '“Bring a friend who is new to Figmark. Get ₹100 store credit for each one, up to 5 friends.”',
    tips: [
      'It runs only for a set time. When time ends, sharers get their credit.',
      'You set the credit per new person and the most one person can earn.',
      'You can add a bonus for the person who brings the most people.',
      'Credit can be spent only at your shop, so it also brings the sharer back.',
    ],
  },
};

/** Spread the word against affiliate commission, row by row. */
const COMPARE: { label: string; spread: string; affiliate: string }[] = [
  { label: 'You pay for', spread: 'A new person who joins Figmark', affiliate: 'A sale of your item' },
  { label: 'Does someone need to buy?', spread: 'No. Joining is enough', affiliate: 'Yes. Only a sale counts' },
  { label: 'Who counts', spread: 'Only people new to Figmark', affiliate: 'Any buyer, new or old' },
  { label: 'The sharer gets', spread: 'Store credit for your shop only', affiliate: 'Money (commission) in their wallet' },
  { label: 'How long it runs', spread: 'A short time you choose', affiliate: 'Always on, until you turn it off' },
  { label: 'Set it up in', spread: 'Engage → Spread the word', affiliate: 'Your item → Affiliate commission' },
  { label: 'Best for', spread: 'Getting new followers and a full live drop', affiliate: 'Selling more of one item' },
];

export function EngageHelp({ id, title, emoji, onStart, onClose }: {
  id: string;
  title: string;
  emoji: string;
  onStart: () => void;
  onClose: () => void;
}) {
  const help = ENGAGE_HELP[id];
  if (!help) return null;
  return (
    <Modal title={`${emoji} ${title}`} onClose={onClose} layout="panel">
      <div className="ehelp">
        <Part head="What is it?"><p>{help.what}</p></Part>
        <Part head="When should I use it?">
          <ul>{help.when.map((line) => <li key={line}>{line}</li>)}</ul>
        </Part>
        <Part head="Example"><p className="ehelp__example">{help.example}</p></Part>
        {help.tips && (
          <Part head="Good to know">
            <ul>{help.tips.map((line) => <li key={line}>{line}</li>)}</ul>
          </Part>
        )}
        {id === 'spread' && (
          <Part head="How is this different from affiliate commission?">
            <p>Both pay people for sharing. But they pay for different things.</p>
            <div className="ehelp__table" role="table" aria-label="Spread the word compared with affiliate commission">
              <div className="ehelp__row ehelp__row--head" role="row">
                <span role="columnheader" />
                <span role="columnheader">📣 Spread the word</span>
                <span role="columnheader">💸 Affiliate</span>
              </div>
              {COMPARE.map((row) => (
                <div key={row.label} className="ehelp__row" role="row">
                  <span role="rowheader">{row.label}</span>
                  <span role="cell">{row.spread}</span>
                  <span role="cell">{row.affiliate}</span>
                </div>
              ))}
            </div>
            <p className="ehelp__simple">
              <strong>In short:</strong> use <b>Spread the word</b> when you want new people to join and follow your shop.
              Use <b>affiliate commission</b> when you want people to help you sell a certain item. You can use both at the same time.
            </p>
          </Part>
        )}
        <div className="ehelp__actions">
          <button type="button" className="btn btn--quiet" onClick={onClose}>Close</button>
          <button type="button" className="btn" onClick={onStart}>Start now</button>
        </div>
      </div>
    </Modal>
  );
}

function Part({ head, children }: { head: string; children: ReactNode }) {
  return (
    <section className="ehelp__part">
      <h3>{head}</h3>
      {children}
    </section>
  );
}
