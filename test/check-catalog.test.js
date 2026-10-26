const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('../scripts/check-catalog');

test('reports missing keys and mismatched placeholders', () => {
  assert.deepEqual(inspect({ welcome: 'Hello {name}', cancel: 'Cancel' }, { welcome: 'Hallo {user}' }, 'de-DE'), [
    'de-DE:welcome: placeholder mismatch', 'de-DE:cancel: missing translation'
  ]);
});

test('accepts complete translations and rejects unknown keys', () => {
  assert.deepEqual(inspect({ welcome: 'Hello {name}' }, { welcome: 'Hallo {name}', extra: 'Zusatz' }, 'de-DE'), ['de-DE:extra: unexpected key']);
  assert.deepEqual(inspect({ welcome: 'Hello {name}' }, { welcome: 'Hallo {name}' }, 'de-DE'), []);
});
