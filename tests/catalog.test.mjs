import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FLAGS, selectItems, facetCounts, normalize, readState, stateParams, plural } from '../public/core.mjs';

const data = JSON.parse(readFileSync(new URL('../public/catalog.json', import.meta.url)));
const items = data.items;
const blank = { q: '', country: '', type: '', flavor: '', sort: 'name' };

test('Every catalogue entry has two photos, valid metadata and a unique ID', () => {
  assert.ok(items.length > 0);
  assert.equal(data.total, items.length);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const item of items) {
    assert.ok(item.country && item.type && item.flavor && FLAGS[item.country]);
    assert.ok(Number.isInteger(item.variant) && item.variant >= 1);
    assert.ok(Number.isFinite(Date.parse(item.addedAt)), `Missing addition date: ${item.id}`);
    for (const key of ['thumbnail', 'image']) {
      assert.match(item[key], /^images\/(thumbs|full)\/[a-f0-9]{16}\.webp$/);
      assert.ok(existsSync(fileURLToPath(new URL(`../public/${item[key]}`, import.meta.url))), item[key]);
    }
  }
  for (const [field, counts] of [['country', data.countries], ['type', data.types]]) {
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), data.total);
    for (const [name, count] of Object.entries(counts)) {
      assert.equal(items.filter((i) => i[field] === name).length, count);
    }
  }
});

test('Combined filters agree with the source and preserve different packaging variants', () => {
  for (const country of Object.keys(data.countries)) {
    assert.equal(selectItems(items, { ...blank, country }).length, data.countries[country]);
    for (const type of Object.keys(data.types)) {
      assert.equal(selectItems(items, { ...blank, country, type }).length, items.filter((i) => i.country === country && i.type === type).length);
    }
  }
  const cheese = selectItems(items, { ...blank, country: 'Россия', type: 'Классика', flavor: 'Сыр' });
  assert.equal(cheese.length, 4);
  assert.deepEqual(cheese.map((i) => i.variant), [1, 2, 3, 4]);
});

test('Search handles case, ё/е, punctuation, combined words and no matches', () => {
  assert.equal(normalize('ЗЕЛЁНЫЙ—ЛУК'), 'зеленый лук');
  const found = selectItems(items, { ...blank, q: 'РОССИЯ зеленый лук' });
  assert.ok(found.length >= 4);
  assert.ok(found.every((i) => i.country === 'Россия' && normalize(i.flavor).includes('зеленый лук')));
  assert.equal(selectItems(items, { ...blank, q: 'zxqv-неттакоговкуса' }).length, 0);
  assert.equal(selectItems(items, { ...blank, country: 'Польша', type: 'Тубус' }).length, 0);
  assert.ok(selectItems(items, { ...blank, q: 'Беларусь' }).some((i) => i.country === 'Беларусия'));
});

test('Shared search links round-trip Cyrillic and special characters', () => {
  const state = { q: 'сыр & перец', country: 'Россия', type: 'Классика', flavor: 'Сыр', sort: 'country' };
  assert.deepEqual(readState('?' + stateParams(state, items[0].id)), state);
  assert.equal(readState('?sort=invalid').sort, 'name');
  assert.deepEqual(readState(''), blank);
  assert.equal(selectItems(items, blank).length, items.length);
});

test('Russian counters use correct forms', () => {
  const forms = ['упаковка', 'упаковки', 'упаковок'];
  for (const [number, expected] of [[1, 'упаковка'], [2, 'упаковки'], [11, 'упаковок'], [21, 'упаковка'], [24, 'упаковки'], [360, 'упаковок']]) assert.equal(plural(number, forms), expected);
});

test('Country narrows types and flavors to the collection of that country', () => {
  const china = items.filter((item) => item.country === 'Китай');
  const facets = facetCounts(items, { ...blank, country: 'Китай' });
  for (const field of ['type', 'flavor']) {
    const expected = Object.fromEntries([...new Set(china.map((item) => item[field]))].map((value) => [value, china.filter((item) => item[field] === value).length]));
    assert.deepEqual({ ...facets[field] }, expected);
    assert.ok(Object.values(facets[field]).every((count) => count > 0));
  }
  assert.equal(facets.type.Kettle, undefined);
});

test('Type narrows countries and flavors in the reverse direction', () => {
  const ridged = items.filter((item) => item.type === 'Рифленые');
  const facets = facetCounts(items, { ...blank, type: 'Рифленые' });
  for (const field of ['country', 'flavor']) {
    const expected = Object.fromEntries([...new Set(ridged.map((item) => item[field]))].map((value) => [value, ridged.filter((item) => item[field] === value).length]));
    assert.deepEqual({ ...facets[field] }, expected);
  }
  assert.equal(facets.country.Мексика, undefined);
});

test('All filters update each other and a selected field still offers compatible alternatives', () => {
  const state = { ...blank, country: 'Китай', type: 'Рифленые', flavor: 'Кимчи' };
  const facets = facetCounts(items, state);
  for (const field of ['country', 'type', 'flavor']) {
    const others = ['country', 'type', 'flavor'].filter((key) => key !== field);
    const compatible = items.filter((item) => others.every((key) => item[key] === state[key]));
    const expected = Object.fromEntries([...new Set(compatible.map((item) => item[field]))].map((value) => [value, compatible.filter((item) => item[field] === value).length]));
    assert.deepEqual({ ...facets[field] }, expected);
  }
  assert.ok(Object.keys(facets.flavor).length > 1);
  assert.ok(facets.flavor['Острый хотпот'] > 0);
  const reset = facetCounts(items, blank);
  assert.deepEqual({ ...reset.country }, data.countries);
  assert.deepEqual({ ...reset.type }, data.types);
});

test('Search narrows dropdown choices and zero matches never turn into an unfiltered list', () => {
  const found = facetCounts(items, { ...blank, country: 'Китай', q: 'острый' });
  const expected = items.filter((item) => item.country === 'Китай' && normalize(`${item.flavor} ${item.type}`).includes('острый'));
  assert.deepEqual(Object.keys(found.flavor).sort(), [...new Set(expected.map((item) => item.flavor))].sort());
  const none = facetCounts(items, { ...blank, q: 'zxqv-неттакоговкуса' });
  for (const field of ['country', 'type', 'flavor']) assert.equal(Object.keys(none[field]).length, 0);
});

test('Addition date sorting uses timestamps rather than catalogue numbers or filenames', () => {
  const sample = [
    { ...items[0], id: 'middle', number: 99, addedAt: '2026-11-09T10:00:00Z' },
    { ...items[0], id: 'old', number: 100, addedAt: '2026-11-08T18:06:56Z' },
    { ...items[0], id: 'new', number: 1, addedAt: '2026-11-10T10:00:00Z' },
  ];
  assert.deepEqual(selectItems(sample, { ...blank, sort: 'newest' }).map(i => i.id), ['new', 'middle', 'old']);
  assert.deepEqual(selectItems(sample, { ...blank, sort: 'oldest' }).map(i => i.id), ['old', 'middle', 'new']);
  assert.deepEqual(sample.map(i => i.id), ['middle', 'old', 'new']);
  for (const sort of ['newest', 'oldest']) {
    const state = { ...blank, sort, country: 'Китай' };
    assert.deepEqual(readState('?' + stateParams(state)), state);
  }
});
