/**
 * The policies, as drafts.
 *
 * Written for an Indian marketplace that holds buyers' payments under Buyer
 * Protection, against the Consumer Protection (E-Commerce) Rules 2020, the
 * IT (Intermediary Guidelines) Rules 2021 and the Digital Personal Data
 * Protection Act 2023. They are a starting point for a lawyer, not legal
 * advice: every page says so, and every [BRACKETED] value is still to fill.
 */
import { LEGAL_VERSION } from '@shared/legal';

export interface LegalSection {
  heading: string;
  body: string[];
}

export interface LegalDoc {
  slug: string;
  title: string;
  summary: string;
  sections: LegalSection[];
}

export { LEGAL_VERSION };

const COMPANY = '[COMPANY LEGAL NAME]';
const ADDRESS = '[REGISTERED OFFICE ADDRESS]';
const SUPPORT = '[SUPPORT EMAIL]';

export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: 'terms',
    title: 'Terms of Use',
    summary: 'The agreement between you and Figmark when you browse, buy or sell.',
    sections: [
      { heading: 'Who we are', body: [
        `Figmark is operated by ${COMPANY} (CIN [CIN]), registered at ${ADDRESS} ("Figmark", "we"). Figmark is an online marketplace: it lets independent sellers and import resellers list items, and buyers buy them. Figmark is not the seller of items listed by others.`,
      ] },
      { heading: 'Your account', body: [
        'You must be 18 or older and able to enter a binding contract under Indian law. One person, one personal account; a shop is run from your account.',
        'Keep your password and authenticator codes to yourself. You are responsible for what is done with your account until you tell us it has been misused.',
        'To buy you must verify your email and WhatsApp number. To sell you must also verify your Aadhaar through UIDAI\'s offline Secure QR, with your consent. We may ask for more when the law or a dispute requires it.',
      ] },
      { heading: 'Buying', body: [
        'A listing is the seller\'s offer. The price, delivery estimate and condition shown when you pay are what you agree to. Pre-orders and group lots arrive later and in stages; their timeline is shown on the order.',
        'With Buyer Protection, your payment is held by Figmark (through our payment partner) and released to the seller when you confirm delivery, or automatically a set number of days after delivery if you raise nothing. The protection fee is shown before you pay.',
        'Paying a seller directly, outside Figmark, is at your own risk and is not covered by Buyer Protection.',
      ] },
      { heading: 'Selling', body: [
        'You must own, or be authorised to sell, what you list; describe it truthfully, with your own photos; and ship within the time you state. You are responsible for taxes on your sales, including GST where it applies, and for the customs duties your listing says are included.',
        'Prohibited items (see the Prohibited items policy) may not be listed. We may remove listings and suspend accounts that break these terms.',
        'Commission and fees are shown in your shop settings before they apply.',
      ] },
      { heading: 'Disputes', body: [
        'If an order goes wrong, raise it from the order. A community manager who is neither the buyer nor the seller reviews both sides and decides where held money goes. Fees for disputes and escalations are shown before you pay them. This does not limit your rights under the Consumer Protection Act, 2019.',
      ] },
      { heading: 'What you post', body: [
        'You keep ownership of your photos and words. You let Figmark show them on the service and in links you share. Do not post anything unlawful, infringing, misleading or abusive; we may remove it and act on reports.',
      ] },
      { heading: 'Liability', body: [
        `To the extent the law allows, Figmark's liability for any claim is limited to the fees you paid Figmark for the transaction concerned. Nothing here excludes liability that cannot be excluded under Indian law.`,
      ] },
      { heading: 'Changes, law and contact', body: [
        'We will tell you before material changes take effect. These terms are governed by the laws of India; courts at [CITY] have jurisdiction, subject to your rights as a consumer.',
        `Questions: ${SUPPORT}. Complaints: see the Grievance Officer page.`,
      ] },
    ],
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    summary: 'What personal data Figmark collects, why, and your rights under the DPDP Act 2023.',
    sections: [
      { heading: 'Who decides', body: [
        `${COMPANY} is the Data Fiduciary for personal data processed through Figmark. Contact our Grievance Officer (see the Grievance Officer page) for anything in this policy.`,
      ] },
      { heading: 'What we collect', body: [
        'Account: name, email, mobile number, username, password (stored only as a one-way hash), and two-factor settings.',
        'Verification: proof that your email and WhatsApp number are yours; for sellers, from your Aadhaar Secure QR, your name and the last four digits of your Aadhaar and a match against your mobile number. We do not store your full Aadhaar number or the QR image.',
        'Trading: listings, orders, payments references, delivery addresses and tracking, messages, disputes and reviews.',
        'Technical: device and browser type, IP address (for security, rate limits and, for new shops, a guess at dispatch region), and notification subscriptions.',
      ] },
      { heading: 'Why, and on what basis', body: [
        'To run the marketplace you asked to use (your consent at sign-up and the uses the DPDP Act allows for it): accounts, orders, Buyer Protection, delivery and disputes.',
        'To keep it safe: verification, fraud and abuse prevention, rate limiting, and keeping records the law requires.',
        'We do not sell personal data. We do not use it for advertising by third parties.',
      ] },
      { heading: 'Who we share it with', body: [
        'The other side of a trade sees what they need to complete it (for example, the seller sees your delivery address). Community managers see the order and dispute they decide.',
        'Processors acting for us: cloud hosting (Microsoft Azure, India region [CONFIRM]), email delivery (Brevo, Mailjet or Resend), WhatsApp Business (Meta), our payment partner, and, for photo search, Anthropic (only the photo, only when you search with one). Authorities, when the law requires.',
      ] },
      { heading: 'How long we keep it', body: [
        'Account data while your account is open. Order and payment records for [8] years, as tax and accounting law requires, even after you delete your account. Verification data until you delete your account or withdraw consent. Security logs for [180] days.',
      ] },
      { heading: 'Your rights', body: [
        'You can see and download your data (Profile → Settings → Download my data), correct it, delete your account (Profile → Settings), withdraw consent, and nominate someone to exercise your rights. You can complain to our Grievance Officer and then to the Data Protection Board of India.',
      ] },
      { heading: 'Children', body: [
        'Figmark is not for anyone under 18, and we do not knowingly process children\'s data.',
      ] },
    ],
  },
  {
    slug: 'refunds',
    title: 'Refunds and Cancellations',
    summary: 'When an order can be cancelled, and how money comes back.',
    sections: [
      { heading: 'Before the seller accepts', body: [
        'You can cancel an order the seller has not accepted from the order page. A payment made is refunded in full.',
      ] },
      { heading: 'After the seller accepts', body: [
        'Cancellation is up to the seller and the listing\'s terms; pre-orders and lot orders may not be cancellable once the seller has paid their supplier. The order page shows what applies.',
      ] },
      { heading: 'If something goes wrong', body: [
        'Item not received, not as described, or damaged: raise a dispute from the order before Buyer Protection releases the payment. A community manager decides; a refund decided in your favour is paid back to your original payment method or as Figmark credit, as you choose.',
      ] },
      { heading: 'Timing', body: [
        'Refunds to cards, UPI and net banking are started within [2] business days of being decided and usually reach you within [5–7] business days, depending on your bank.',
      ] },
    ],
  },
  {
    slug: 'shipping',
    title: 'Shipping and Delivery',
    summary: 'How orders travel, including imports and group lots.',
    sections: [
      { heading: 'Who ships', body: [
        'Sellers ship their own orders, directly or through a freight forwarder or handler shown on the order. Figmark does not carry goods.',
      ] },
      { heading: 'Imports and lots', body: [
        'Imported items often travel in a group lot: the seller orders from the supplier, the lot is consolidated abroad, flown or shipped, cleared through customs, then dispatched in India. Each stage is shown on the order with an estimate. Customs delays can move those estimates.',
      ] },
      { heading: 'Duties', body: [
        'Whether customs duty is included is stated on the listing. Where it is not, the seller tells you the amount before you pay it.',
      ] },
      { heading: 'Delivery', body: [
        'Tracking is added to the order when the parcel is handed to a courier. Confirm delivery from the order once it arrives, or raise a dispute if it does not.',
      ] },
    ],
  },
  {
    slug: 'prohibited',
    title: 'Prohibited Items',
    summary: 'What may not be listed or sold on Figmark.',
    sections: [
      { heading: 'Never allowed', body: [
        'Counterfeit or replica goods, and anything infringing someone\'s trademark or copyright. Weapons, ammunition, explosives and their parts. Drugs, medicines and supplements, alcohol and tobacco. Wildlife and products of protected species. Stolen goods. Adult content. Personal data, accounts and documents. Anything banned from import or sale in India.',
      ] },
      { heading: 'Allowed with care', body: [
        'Collectibles that resemble restricted items (for example, replica props) must be clearly described and lawful to own. Batteries, magnets and liquids must meet the carrier\'s rules.',
      ] },
      { heading: 'What we do', body: [
        'We remove listings that break this policy, may hold payments on related orders, and may suspend repeat offenders. Report a listing from its page.',
      ] },
    ],
  },
  {
    slug: 'grievance',
    title: 'Grievance Officer',
    summary: 'Who to contact with a complaint, and how quickly you will hear back.',
    sections: [
      { heading: 'Contact', body: [
        'Name: [GRIEVANCE OFFICER NAME]. Designation: [DESIGNATION].',
        `Address: ${ADDRESS}. Email: [GRIEVANCE EMAIL]. Phone: [PHONE], [HOURS] on working days.`,
      ] },
      { heading: 'What happens', body: [
        'We acknowledge every complaint within 48 hours and resolve it within one month of receiving it, as the Consumer Protection (E-Commerce) Rules 2020 and the IT Rules 2021 require. Requests to remove unlawful content are acted on within the times those Rules set.',
      ] },
      { heading: 'Escalation', body: [
        'If you are not satisfied, you may approach the National Consumer Helpline (1915) or the consumer commission, and, for personal data, the Data Protection Board of India.',
      ] },
    ],
  },
];
