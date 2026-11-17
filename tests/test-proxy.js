// Tests de la fonction Vercel api/proxy.js, avec un faux service IA (aucun appel réseau réel).
// Usage : node tests/test-proxy.js

import assert from 'node:assert/strict';
import { traiter } from '../api/proxy.js';

const JETON = 'jeton-de-test-suffisamment-long-0123456789';
const ENV = { ANTHROPIC_API_KEY: 'cle-factice', PROXY_TOKEN: JETON };
const URL_PROXY = 'https://exemple.vercel.app/api/proxy';
const ORIGINE = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

let appels = [];
globalThis.fetch = async (url, init) => {
  appels.push({ url, init });
  return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn' }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};

function requete(corps, entetes = {}, methode = 'POST') {
  return new Request(URL_PROXY, {
    method: methode,
    headers: { 'content-type': 'application/json', origin: ORIGINE, ...entetes },
    body: methode === 'POST' ? JSON.stringify(corps) : undefined
  });
}

const corpsValide = {
  model: 'claude-sonnet-5-5',
  max_tokens: 900,
  system: 'S',
  messages: [{ role: 'user', content: 'U' }],
  thinking: { type: 'between_tools' },
  fallbacks: 'default'
};

let reussis = 0;
async function test(nom, fn) {
  appels = [];
  await fn();
  reussis++;
  console.log('  ok  ' + nom);
}

await test('Pré-vol CORS pour une extension Chrome', async () => {
  const r = await traiter(requete(null, {}, 'OPTIONS'), ENV);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGINE);
});

await test('Non configuré : 503', async () => {
  const r = await traiter(requete(corpsValide, { authorization: 'Bearer ' + JETON }), {});
  assert.equal(r.status, 503);
  assert.equal(appels.length, 0);
});

await test('Jeton absent : 401', async () => {
  const r = await traiter(requete(corpsValide), ENV);
  assert.equal(r.status, 401);
  assert.equal(appels.length, 0);
});

await test('Mauvais jeton : 401', async () => {
  const r = await traiter(requete(corpsValide, { authorization: 'Bearer faux' }), ENV);
  assert.equal(r.status, 401);
});

await test('GET refusé : 405', async () => {
  const r = await traiter(new Request(URL_PROXY, { method: 'GET' }), ENV);
  assert.equal(r.status, 405);
});

await test('Messages invalides : 400', async () => {
  const r = await traiter(requete({ ...corpsValide, messages: [] }, { authorization: 'Bearer ' + JETON }), ENV);
  assert.equal(r.status, 400);
});

await test('Requête valide transmise avec la clé serveur', async () => {
  const r = await traiter(requete({ ...corpsValide, max_tokens: 99999, extra: 'ignoré' }, { authorization: 'Bearer ' + JETON }), ENV);
  assert.equal(r.status, 200);
  assert.equal(appels.length, 1);
  const { url, init } = appels[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.headers['x-api-key'], 'cle-factice');
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  assert.equal(init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  const envoye = JSON.parse(init.body);
  assert.equal(envoye.max_tokens, 2000, 'max_tokens plafonné');
  assert.equal(envoye.extra, undefined, 'champs inconnus retirés');
  assert.equal(envoye.thinking.type, 'between_tools');
  const donnees = await r.json();
  assert.equal(donnees.content[0].text, '{"ok":true}');
});

await test('Nom de modèle suspect remplacé par le modèle par défaut', async () => {
  await traiter(requete({ ...corpsValide, model: 'gpt; rm -rf' }, { authorization: 'Bearer ' + JETON }), ENV);
  assert.equal(JSON.parse(appels[0].init.body).model, 'claude-sonnet-5-5');
});

console.log(`\n${reussis} tests du proxy réussis.`);
