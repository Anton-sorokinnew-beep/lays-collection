const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

export const FLAGS = {
  'Беларусия': '🇧🇾', 'Великобритания': '🇬🇧', 'Вьетнам': '🇻🇳',
  'Германия': '🇩🇪', 'Египет': '🇪🇬', 'Индия': '🇮🇳', 'Индонезия': '🇮🇩',
  'Италия': '🇮🇹', 'Китай': '🇨🇳', 'Мексика': '🇲🇽', 'Польша': '🇵🇱',
  'Россия': '🇷🇺', 'Румыния': '🇷🇴', 'США': '🇺🇸', 'Саудовская Аравия': '🇸🇦',
  'Сербия': '🇷🇸', 'Таиланд': '🇹🇭', 'Тайвань': '🇹🇼', 'Турция': '🇹🇷', 'Франция': '🇫🇷',
};

export const countryLabel = (name) => name === 'Беларусия' ? 'Беларусь' : name;
export const normalize = (text) => String(text).normalize('NFC').toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const compare = (a, b) => collator.compare(a, b);
export function plural(number, forms) {
  const n = Math.abs(number) % 100;
  const last = n % 10;
  return forms[n > 10 && n < 20 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2];
}

const COUNTRY_ALIASES = {
  'Беларусия': 'Белоруссия Belarus', 'Россия': 'Russia', 'Китай': 'China',
  'США': 'Америка USA United States', 'Таиланд': 'Thailand', 'Тайвань': 'Taiwan',
  'Великобритания': 'Англия UK Walkers', 'Вьетнам': 'Vietnam', 'Индия': 'India',
  'Германия': 'Germany', 'Турция': 'Turkey', 'Египет': 'Egypt',
};

export function searchText(item) {
  return normalize([item.flavor, item.country, countryLabel(item.country), COUNTRY_ALIASES[item.country] || '', item.type, 'Lay’s Lays Лейс', item.variant > 1 ? `вариант ${item.variant}` : ''].join(' '));
}

const FILTER_FIELDS = ['country', 'type', 'flavor'];

function matchesItem(item, state, terms, ignoredField = '') {
  return FILTER_FIELDS.every((field) => field === ignoredField || !state[field] || item[field] === state[field]) &&
    terms.every((term) => (item.search || searchText(item)).includes(term));
}

export function facetCounts(items, state) {
  const terms = normalize(state.q || '').split(' ').filter(Boolean);
  // Each list respects the other filters, while allowing a different value in its own field.
  return Object.fromEntries(FILTER_FIELDS.map((field) => {
    const counts = Object.create(null);
    for (const item of items) {
      if (matchesItem(item, state, terms, field)) counts[item[field]] = (counts[item[field]] || 0) + 1;
    }
    return [field, counts];
  }));
}

export function selectItems(items, state) {
  const terms = normalize(state.q || '').split(' ').filter(Boolean);
  const result = items.filter((item) => matchesItem(item, state, terms));
  return result.sort((a, b) => {
    if (state.sort === 'newest' || state.sort === 'oldest') {
      const delta = Date.parse(a.addedAt) - Date.parse(b.addedAt);
      return (state.sort === 'newest' ? -delta : delta) || a.number - b.number;
    }
    if (state.sort === 'country') return compare(countryLabel(a.country), countryLabel(b.country)) || compare(a.flavor, b.flavor) || a.variant - b.variant;
    if (state.sort === 'number') return a.number - b.number;
    return compare(a.flavor, b.flavor) || compare(a.country, b.country) || compare(a.type, b.type) || a.variant - b.variant;
  });
}

export function readState(search) {
  const params = new URLSearchParams(search);
  return { q: (params.get('q') || '').slice(0, 300), country: params.get('country') || '', type: params.get('type') || '', flavor: params.get('flavor') || '', sort: ['name', 'country', 'number', 'newest', 'oldest'].includes(params.get('sort')) ? params.get('sort') : 'name' };
}

export function stateParams(state, item = '') {
  const params = new URLSearchParams();
  for (const key of ['q', 'country', 'type', 'flavor']) if (state[key]) params.set(key, state[key]);
  if (state.sort !== 'name') params.set('sort', state.sort);
  if (item) params.set('item', item);
  return params.toString();
}
