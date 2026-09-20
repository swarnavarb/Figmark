/**
 * Countries, for the origin/destination pickers.
 *
 * A plain list of names rather than ISO codes: nothing here stores a code or
 * looks one up, so there is nothing a code buys that a name does not, and a
 * name is what renders directly into a route step ("Received at 'China'
 * Dispatch Center") without a lookup table in between.
 */
export const COUNTRIES: readonly string[] = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Argentina', 'Armenia', 'Australia',
  'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium',
  'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei',
  'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Chad', 'Chile', 'China',
  'Colombia', 'Comoros', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czechia', 'Denmark',
  'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Estonia',
  'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana',
  'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guyana', 'Haiti', 'Honduras', 'Hong Kong', 'Hungary',
  'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan',
  'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho',
  'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macau', 'Madagascar', 'Malawi',
  'Malaysia', 'Maldives', 'Mali', 'Malta', 'Mauritania', 'Mauritius', 'Mexico', 'Moldova', 'Monaco',
  'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nepal', 'Netherlands',
  'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway',
  'Oman', 'Pakistan', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland',
  'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saudi Arabia', 'Senegal', 'Serbia',
  'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Somalia', 'South Africa',
  'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland',
  'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Togo', 'Trinidad and Tobago', 'Tunisia',
  'Turkey', 'Turkmenistan', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom',
  'United States', 'Uruguay', 'Uzbekistan', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
];

/**
 * ISO 3166-1 alpha-2 code for each entry in `COUNTRIES`, same order - kept
 * only to draw a flag. Nothing else needs a code: everything upstream of this
 * stores and reads the plain name, which is what a route step's own words
 * ("Received at 'China' Dispatch Center") are built from.
 */
const COUNTRY_ISO2 = (
  'AF AL DZ AD AO AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI KH CM CA TD CL CN '
  + 'CO KM CG CR HR CU CY CZ DK DJ DM DO EC EG SV EE ET FJ FI FR GA GM GE DE GH GR GD GT GN GY HT HN HK HU '
  + 'IS IN ID IR IQ IE IL IT JM JP JO KZ KE KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MR MU MX '
  + 'MD MC MN ME MA MZ MM NA NP NL NZ NI NE NG KP MK NO OM PK PA PG PY PE PH PL PT QA RO RU RW SA SN RS SC '
  + 'SL SG SK SI SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TG TT TN TR TM UG UA AE GB US UY UZ VE VN YE ZM ZW'
).split(' ');

const FLAG_CODE_BY_COUNTRY = new Map(COUNTRIES.map((name, i) => [name, COUNTRY_ISO2[i]!]));

/**
 * A country's flag, drawn from its two-letter code as the pair of Unicode
 * regional-indicator symbols every current OS renders as that flag - so
 * nothing here stores or ships an emoji character directly. Falls back to a
 * globe for a country typed before the list existed, or none at all.
 */
export function countryFlag(country: string | null | undefined): string {
  const code = country ? FLAG_CODE_BY_COUNTRY.get(country.trim()) : undefined;
  if (!code) return '🌐';
  return [...code].map((letter) => String.fromCodePoint(0x1F1E6 + letter.charCodeAt(0) - 65)).join('');
}
