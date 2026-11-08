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

export function selectItems(items, state) {
  const terms = normalize(state.q || '').split(' ').filter(Boolean);
  const result = items.filter((item) =>
    (!state.country || item.country === state.country) &&
    (!state.type || item.type === state.type) &&
    (!state.flavor || item.flavor === state.flavor) &&
    terms.every((term) => (item.search || searchText(item)).includes(term))
  );
  return result.sort((a, b) => {
    if (state.sort === 'country') return compare(countryLabel(a.country), countryLabel(b.country)) || compare(a.flavor, b.flavor) || a.variant - b.variant;
    if (state.sort === 'number') return a.number - b.number;
    return compare(a.flavor, b.flavor) || compare(a.country, b.country) || compare(a.type, b.type) || a.variant - b.variant;
  });
}

export function readState(search) {
  const params = new URLSearchParams(search);
  return { q: (params.get('q') || '').slice(0, 300), country: params.get('country') || '', type: params.get('type') || '', flavor: params.get('flavor') || '', sort: ['name', 'country', 'number'].includes(params.get('sort')) ? params.get('sort') : 'name' };
}

export function stateParams(state, item = '') {
  const params = new URLSearchParams();
  for (const key of ['q', 'country', 'type', 'flavor']) if (state[key]) params.set(key, state[key]);
  if (state.sort !== 'name') params.set('sort', state.sort);
  if (item) params.set('item', item);
  return params.toString();
}
