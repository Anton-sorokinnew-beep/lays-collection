import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FLAGS, selectItems, normalize, readState, stateParams, plural } from '../public/core.mjs';

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
