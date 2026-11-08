import { FLAGS, countryLabel, compare, plural, searchText, selectItems, facetCounts, indexVariants, readState, stateParams } from './core.mjs?v=7';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 24;
let data;
let items = [];
let variantIndex = new Map();
let results = [];
let visibleCount = PAGE_SIZE;
let state = readState(location.search);
let currentItem = null;
let opener = null;
let searchTimer;
let lastRandomId = null;
const dialog = $('pack-dialog');
const controls = { q: $('search'), country: $('country'), type: $('type'), flavor: $('flavor'), sort: $('sort') };

function syncUrl(item = currentItem?.id || '') {
  const query = stateParams(state, item);
  history.replaceState(null, '', `${location.pathname}${query ? '?' + query : ''}${location.hash}`);
}

function fillSelect(id, values, allLabel, label = (value) => value) {
  const select = $(id);
  select.replaceChildren(new Option(allLabel, ''));
  const sortLabel = id === 'country' ? countryLabel : (value) => value;
  for (const [value, count] of Object.entries(values).sort(([a], [b]) => compare(sortLabel(a), sortLabel(b)))) {
    select.add(new Option(`${label(value)} (${count})`, value));
  }
  const selected = state[id];
  // Keep an unavailable selection explicit for stale links or a search with no matches.
  if (selected && !Object.hasOwn(values, selected)) select.add(new Option(`${label(selected)} (0)`, selected));
  select.value = selected;
}

function restoreControls() {
  for (const [key, element] of Object.entries(controls)) element.value = state[key];
}

function updateFilterOptions() {
  const counts = facetCounts(items, state);
  fillSelect('country', counts.country, 'Все страны', (country) => `${FLAGS[country] || ''} ${countryLabel(country)}`);
  fillSelect('type', counts.type, 'Все виды');
  fillSelect('flavor', counts.flavor, 'Все вкусы');
}

function variantPicker(item, context) {
  const variants = variantIndex.get(item.id) || [];
  if (variants.length < 2) return null;
  const picker = document.createElement('div');
  picker.className = `variant-picker variant-picker--${context}`;
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', `Варианты упаковки: ${item.flavor}, ${countryLabel(item.country)}, ${item.type}`);
  const label = document.createElement('p');
  label.className = 'variant-picker-label';
  label.textContent = `Варианты упаковки (${variants.length})`;
  const row = document.createElement('div');
  row.className = 'variant-thumbs';
  for (const variant of variants) {
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'variant-thumb';
    thumb.dataset.variantId = variant.id;
    const active = variant.id === item.id;
    thumb.classList.toggle('is-active', active);
    thumb.setAttribute('aria-pressed', String(active));
    thumb.setAttribute('aria-label', `Вариант ${variant.variant}, ${variant.flavor}, ${countryLabel(variant.country)}, ${variant.type}`);
    thumb.title = `Вариант ${variant.variant}`;
    const image = new Image();
    image.src = variant.thumbnail;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.width = 44;
    image.height = 62;
    const number = document.createElement('span');
    number.className = 'variant-number';
    number.textContent = variant.variant;
    number.setAttribute('aria-hidden', 'true');
    thumb.append(image, number);
    thumb.addEventListener('click', () => {
      const inDialog = context === 'dialog';
      if (inDialog && currentItem?.id === variant.id) return;
      const scrollLeft = row.scrollLeft;
      openPack(variant, inDialog ? null : thumb);
      if (inDialog) {
        const nextRow = $('dialog-variants').querySelector('.variant-thumbs');
        nextRow.scrollLeft = scrollLeft;
        nextRow.querySelector('[aria-pressed="true"]').focus({ preventScroll: true });
      }
    });
    row.append(thumb);
  }
  picker.append(label, row);
  return picker;
}

function renderDialogVariants(item) {
  const host = $('dialog-variants');
  const picker = variantPicker(item, 'dialog');
  host.replaceChildren();
  host.hidden = !picker;
  if (picker) host.append(picker);
}

function card(item) {
  const article = document.createElement('article');
  article.className = 'card';
  article.dataset.itemId = item.id;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'card-button';
  button.setAttribute('aria-label', `${item.flavor}, ${countryLabel(item.country)}, ${item.type}, вариант ${item.variant}. Открыть фото`);
  const photo = document.createElement('div');
  photo.className = 'card-image';
  const image = new Image();
  image.src = item.thumbnail;
  image.alt = `Lay’s — ${item.flavor}, ${countryLabel(item.country)}`;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.width = 540;
  image.height = 680;
  photo.append(image);
  if (item.variant > 1) {
    const variant = document.createElement('span');
    variant.className = 'card-variant';
    variant.textContent = `Вариант ${item.variant}`;
    photo.append(variant);
  }
  const zoom = document.createElement('span');
  zoom.className = 'card-zoom';
  zoom.setAttribute('aria-hidden', 'true');
  zoom.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.5"/><path d="m12 12 5 5M5.5 8h5M8 5.5v5"/></svg>';
  photo.append(zoom);
  const body = document.createElement('div');
  body.className = 'card-body';
  const title = document.createElement('h3');
  title.textContent = item.flavor;
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const country = document.createElement('span');
  country.className = 'card-country';
  const flag = document.createElement('span');
  flag.setAttribute('aria-hidden', 'true');
  flag.textContent = FLAGS[item.country] || '🌍';
  country.append(flag, document.createTextNode(countryLabel(item.country)));
  const dot = document.createElement('span');
  dot.className = 'meta-dot';
  dot.textContent = '·';
  const type = document.createElement('span');
  type.textContent = item.type;
  meta.append(country, dot, type);
  body.append(title, meta);
  button.append(photo, body);
  button.addEventListener('click', () => openPack(item, button));
  article.append(button);
  const picker = variantPicker(item, 'card');
  if (picker) article.append(picker);
  return article;
}

function renderGrid(append = false) {
  const grid = $('grid');
  const start = append ? grid.childElementCount : 0;
  if (!append) grid.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const item of results.slice(start, visibleCount)) fragment.append(card(item));
  grid.append(fragment);
  grid.setAttribute('aria-busy', 'false');
  $('empty-state').hidden = results.length > 0;
  $('load-more').hidden = visibleCount >= results.length;
  $('shown-count').textContent = results.length ? `Показано ${Math.min(visibleCount, results.length)} из ${results.length}` : '';
  if (append) grid.children[start]?.querySelector('button')?.focus({ preventScroll: true });
}

function renderChips() {
  const container = $('active-filters');
  container.replaceChildren();
  for (const key of ['q', 'country', 'type', 'flavor']) {
    if (!state[key]) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-chip';
    const value = key === 'country' ? countryLabel(state[key]) : state[key];
    button.append(document.createTextNode(key === 'q' ? `Поиск: ${value}` : value));
    const cross = document.createElement('span');
    cross.textContent = '×';
    cross.setAttribute('aria-hidden', 'true');
    button.append(cross);
    button.setAttribute('aria-label', `Убрать фильтр: ${value}`);
    button.addEventListener('click', () => {
      state[key] = '';
      controls[key].value = '';
      clearTimeout(searchTimer);
      applyFilters();
      controls[key].focus({ preventScroll: true });
    });
    container.append(button);
  }
}

function applyFilters() {
  results = selectItems(items, state);
  updateFilterOptions();
  visibleCount = PAGE_SIZE;
  const filtering = Boolean(state.q || state.country || state.type || state.flavor);
  $('catalog-title').textContent = filtering ? 'Результаты поиска' : 'Все упаковки';
  $('result-count').textContent = filtering ? `${results.length} из ${data.total}` : `${data.total} ${plural(data.total, ['упаковка', 'упаковки', 'упаковок'])}`;
  $('reset').disabled = !filtering;
  const count = ['country', 'type', 'flavor'].filter((key) => state[key]).length;
  $('filter-count').textContent = count ? String(count) : '';
  renderChips();
  renderGrid();
  syncUrl();
}

function reset() {
  clearTimeout(searchTimer);
  state = { q: '', country: '', type: '', flavor: '', sort: 'name' };
  restoreControls();
  applyFilters();
}

function openPack(item, source = null, updateUrl = true) {
  currentItem = item;
  if (!dialog.open) opener = source;
  $('dialog-title').textContent = item.flavor;
  $('dialog-country').textContent = `${FLAGS[item.country] || ''} ${countryLabel(item.country)}`;
  $('dialog-type').textContent = item.type;
  $('dialog-variant').textContent = item.variant;
  $('dialog-number').textContent = `№ ${item.number}`;
  $('dialog-added').textContent = item.addedAt ? new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }).format(new Date(item.addedAt)) : '—';
  $('dialog-image').src = item.image;
  $('dialog-image').alt = `Упаковка Lay’s ${item.flavor}, ${countryLabel(item.country)}, ${item.type}, вариант ${item.variant}`;
  $('open-photo').href = item.image;
  renderDialogVariants(item);
  $('share-status').textContent = '';
  $('share').textContent = 'Скопировать ссылку';
  document.body.style.overflow = 'hidden';
  if (!dialog.open) dialog.showModal();
  const variantRow = $('dialog-variants').querySelector('.variant-thumbs');
  const activeThumb = variantRow?.querySelector('[aria-pressed="true"]');
  if (activeThumb) variantRow.scrollLeft = Math.max(0, activeThumb.offsetLeft + activeThumb.offsetWidth - variantRow.clientWidth + 3);
  if (updateUrl) syncUrl(item.id);
}

dialog.addEventListener('close', () => {
  currentItem = null;
  document.body.style.overflow = '';
  $('dialog-image').removeAttribute('src');
  syncUrl('');
  if (opener?.isConnected) opener.focus({ preventScroll: true });
});
$('close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
});
$('share').addEventListener('click', async () => {
  const itemId = currentItem?.id;
  try {
    await navigator.clipboard.writeText(location.href);
    if (currentItem?.id === itemId) $('share-status').textContent = 'Ссылка скопирована';
  } catch {
    $('share-status').textContent = 'Скопируй ссылку из адресной строки браузера.';
  }
});

controls.q.addEventListener('input', () => {
  clearTimeout(searchTimer);
  state.q = controls.q.value;
  searchTimer = setTimeout(() => { if (data) applyFilters(); }, 150);
});
for (const key of ['country', 'type', 'flavor', 'sort']) {
  controls[key].addEventListener('change', () => {
    clearTimeout(searchTimer);
    state.q = controls.q.value;
    state[key] = controls[key].value;
    applyFilters();
  });
}
$('reset').addEventListener('click', reset);
$('empty-reset').addEventListener('click', reset);
$('random-flavor').addEventListener('click', () => {
  if (!items.length) return;
  const candidates = items.length > 1 ? items.filter((item) => item.id !== lastRandomId) : items;
  const item = candidates[Math.floor(Math.random() * candidates.length)];
  lastRandomId = item.id;
  openPack(item, $('random-flavor'));
});
$('mobile-filters').addEventListener('click', () => {
  const open = $('filter-panel').classList.toggle('is-open');
  $('mobile-filters').setAttribute('aria-expanded', String(open));
});
$('load-more').addEventListener('click', () => { visibleCount += PAGE_SIZE; renderGrid(true); });
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !dialog.open && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
    event.preventDefault(); controls.q.focus();
  }
});
window.addEventListener('popstate', () => {
  if (!data) return;
  const itemId = new URLSearchParams(location.search).get('item');
  state = readState(location.search);
  if (dialog.open) dialog.close();
  restoreControls();
  applyFilters();
  const item = items.find((item) => item.id === itemId);
  if (item) openPack(item);
});

async function load() {
  $('error-state').hidden = true;
  $('grid').setAttribute('aria-busy', 'true');
  $('result-count').textContent = 'Загрузка…';
  try {
    const response = await fetch(new URL('./catalog.json?v=6', import.meta.url), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const loaded = await response.json();
    if (!Array.isArray(loaded.items) || loaded.total !== loaded.items.length) throw new Error('Invalid catalogue');
    data = loaded;
    items = data.items.map((item) => ({ ...item, search: searchText(item) }));
    variantIndex = indexVariants(items);
    $('total-stat').textContent = data.total;
    $('total-label').textContent = `${plural(data.total, ['упаковка', 'упаковки', 'упаковок'])} в коллекции`;
    const countries = Object.keys(data.countries).length;
    const types = Object.keys(data.types).length;
    $('countries-stat').textContent = countries;
    $('countries-label').textContent = plural(countries, ['страна', 'страны', 'стран']);
    $('types-stat').textContent = types;
    $('types-label').textContent = plural(types, ['вид чипсов', 'вида чипсов', 'видов чипсов']);
    const hero = [
      items.find((i) => i.country === 'Россия' && i.flavor === 'Сметана и зелень' && i.variant === 1),
      items.find((i) => i.country === 'Китай' && i.flavor === 'Острые раки' && i.variant === 1),
      items.find((i) => i.country === 'Россия' && i.flavor === 'Сыр' && i.variant === 1),
    ];
    ['hero-left', 'hero-right', 'hero-center'].forEach((id, index) => { $(id).src = (hero[index] || items[index]).thumbnail; });
    const date = new Date(data.updatedAt);
    $('updated').textContent = `Каталог обновлён ${new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }).format(date)}`;
    const itemId = new URLSearchParams(location.search).get('item');
    restoreControls();
    applyFilters();
    const sharedItem = items.find((item) => item.id === itemId);
    if (sharedItem) openPack(sharedItem);
    $('random-flavor').disabled = items.length === 0;
  } catch (error) {
    $('grid').setAttribute('aria-busy', 'false');
    $('error-state').hidden = false;
    $('result-count').textContent = 'Каталог недоступен';
    console.error('Catalogue loading failed:', error);
  }
}
$('retry').addEventListener('click', load);
load();
