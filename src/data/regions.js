// Continent regions used by the world backdrop, the news map and the news feed.
// Keys are stable ids; colors live in tokens.css as --tone-<key>.
export const REGIONS = [
  { key: 'europe',   label: 'Europe',        short: 'EU' },
  { key: 'africa',   label: 'Africa',        short: 'AF' },
  { key: 'asia',     label: 'Asia',          short: 'AS' },
  { key: 'mideast',  label: 'Middle East',   short: 'ME' },
  { key: 'namerica', label: 'North America', short: 'NA' },
  { key: 'samerica', label: 'South America', short: 'SA' },
  { key: 'oceania',  label: 'Oceania',       short: 'OC' }
];

export const REGION_INDEX = Object.fromEntries(REGIONS.map((r, i) => [r.key, i]));

// Country names as they appear in world-atlas/countries-110m.json.
const BY_REGION = {
  europe: ['France', 'Norway', 'Sweden', 'Belarus', 'Ukraine', 'Poland', 'Austria', 'Hungary', 'Moldova',
    'Romania', 'Lithuania', 'Latvia', 'Estonia', 'Germany', 'Bulgaria', 'Greece', 'Albania', 'Croatia',
    'Switzerland', 'Luxembourg', 'Belgium', 'Netherlands', 'Portugal', 'Spain', 'Ireland', 'Italy', 'Denmark',
    'United Kingdom', 'Iceland', 'Slovenia', 'Finland', 'Slovakia', 'Czechia', 'Bosnia and Herz.', 'Macedonia',
    'Serbia', 'Montenegro', 'Kosovo', 'Cyprus', 'N. Cyprus'],
  africa: ['Tanzania', 'W. Sahara', 'Dem. Rep. Congo', 'Somalia', 'Kenya', 'Sudan', 'Chad', 'South Africa',
    'Lesotho', 'Zimbabwe', 'Botswana', 'Namibia', 'Senegal', 'Mali', 'Mauritania', 'Benin', 'Niger', 'Nigeria',
    'Cameroon', 'Togo', 'Ghana', "Côte d'Ivoire", 'Guinea', 'Guinea-Bissau', 'Liberia', 'Sierra Leone',
    'Burkina Faso', 'Central African Rep.', 'Congo', 'Gabon', 'Eq. Guinea', 'Zambia', 'Malawi', 'Mozambique',
    'eSwatini', 'Angola', 'Burundi', 'Madagascar', 'Gambia', 'Tunisia', 'Algeria', 'Eritrea', 'Morocco', 'Libya',
    'Ethiopia', 'Djibouti', 'Somaliland', 'Uganda', 'Rwanda', 'S. Sudan'],
  mideast: ['Israel', 'Lebanon', 'Palestine', 'Jordan', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Iraq', 'Oman',
    'Iran', 'Syria', 'Turkey', 'Yemen', 'Saudi Arabia', 'Egypt'],
  asia: ['Kazakhstan', 'Uzbekistan', 'Timor-Leste', 'Indonesia', 'Cambodia', 'Thailand', 'Laos', 'Myanmar',
    'Vietnam', 'North Korea', 'South Korea', 'Mongolia', 'India', 'Bangladesh', 'Bhutan', 'Nepal', 'Pakistan',
    'Afghanistan', 'Tajikistan', 'Kyrgyzstan', 'Turkmenistan', 'Armenia', 'Sri Lanka', 'China', 'Taiwan',
    'Azerbaijan', 'Georgia', 'Philippines', 'Malaysia', 'Brunei', 'Japan', 'Russia'],
  namerica: ['Canada', 'United States of America', 'Haiti', 'Dominican Rep.', 'Bahamas', 'Greenland', 'Mexico',
    'Panama', 'Costa Rica', 'Nicaragua', 'Honduras', 'El Salvador', 'Guatemala', 'Belize', 'Puerto Rico',
    'Jamaica', 'Cuba', 'Trinidad and Tobago'],
  samerica: ['Argentina', 'Chile', 'Falkland Is.', 'Uruguay', 'Brazil', 'Bolivia', 'Peru', 'Colombia',
    'Venezuela', 'Guyana', 'Suriname', 'Ecuador', 'Paraguay'],
  oceania: ['Fiji', 'Papua New Guinea', 'Vanuatu', 'New Caledonia', 'Solomon Is.', 'New Zealand', 'Australia']
};

const NAME_TO_REGION = {};
for (const [key, names] of Object.entries(BY_REGION)) for (const n of names) NAME_TO_REGION[n] = key;

// Russia is split at the Urals so western Russia reads as Europe on the map.
export function regionOf(countryName, lon) {
  if (countryName === 'Russia') return lon < 60 ? 'europe' : 'asia';
  return NAME_TO_REGION[countryName] || null;
}
