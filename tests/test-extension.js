// Test de bout en bout : charge l'extension dans Chromium (Playwright), simule les raccourcis
// via le service worker, et remplace l'API Anthropic par un faux serveur (aucun appel réel).
// Usage : node tests/test-extension.js
//
// Note : les raccourcis clavier eux-mêmes ne peuvent pas être pressés en automatique
// (ils sont gérés par Chrome hors de la page). Le test appelle donc directement le
// gestionnaire de commande du service worker, avec une copie de l'extension qui a le
// droit de lire la page de test (en usage réel, c'est activeTab qui donne ce droit).

import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node-tools/node_modules/playwright');
}
const { chromium } = playwright;

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const dossierExtension = join(racine, 'extension-reponses-linkedin');
const dossierCaptures = join(racine, 'tests', 'captures');
const TIRET_LONG = '\u2014';

const TEXTES = {
  post: 'Les soignants passent encore un tiers de leur temps sur l\'administratif. L\'IA peut aider, a condition de partir des usages réels.',
  commentaire: 'Encore faut-il que les établissements donnent un cadre clair. Sans gouvernance, chacun bricole dans son coin.',
  reponse: 'Le cadre existe déjà, c\'est la formation qui manque.'
};

// -----------------------------------------------------------------------------
// Page LinkedIn simulée
// -----------------------------------------------------------------------------

function demarrerServeurPage() {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fil simulé</title></head><body>
    <article><p id="post">${TEXTES.post}</p></article>
    <div><p id="commentaire">${TEXTES.commentaire}</p></div>
    <div><p id="reponse">${TEXTES.reponse}</p></div>
    <textarea id="zone">Texte dans une zone de saisie</textarea>
  </body></html>`;
  const serveur = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => serveur.listen(0, '127.0.0.1', () => resolve(serveur)));
}

// -----------------------------------------------------------------------------
// Faux service IA
// -----------------------------------------------------------------------------

const requetesIA = [];
const filReponses = [];

function reponseModele(objet) {
  return {
    status: 200,
    body: JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: typeof objet === 'string' ? objet : JSON.stringify(objet) }],
      stop_reason: 'end_turn'
    })
  };
}

// Exemple au format standard : 3 lignes maximum, phrases courtes, 2 fautes par commentaire.
const RESULTAT_TYPE = {
  mode: 'reponse_a_reponse',
  cas: 'standard',
  variantes: [
    {
      angle: 'point_non_vu',
      texte: 'Former sans créneau, c\'est un voeu pieux ' + TIRET_LONG + ' on oublie le lendemain.\nMoi je parie sur le temps protégé ; pas sur le catalogue.',
      fautes: ['voeu (vœu)', 'tres (très)']
    },
    {
      angle: 'reflexion',
      texte: 'J\'ai du mal avec les cadres que personne n\'a lus.\nUn texte rangé dans un intranet, ca ne protège personne ;-)',
      fautes: ['ca (ça)', 'enfait (en fait)']
    },
    {
      angle: 'reflexion',
      texte: 'Je me méfie des chartes signées a la va-vite.\nOn coche la case.\nEt la pratique reste la meme.',
      fautes: ['a (à)', 'meme (même)']
    },
    {
      angle: 'point_non_vu',
      texte: 'Et pourtant, le premier frein, c\'est l\'agenda des équipes.\nSans créneau protégé, la formation passe aprés l\'urgence.',
      fautes: ['aprés (après)', 'parceque (parce que)']
    }
  ],
  humour: { texte: 'Une charte IA sans formation, c\'est un GPS sans écran ;-)', fautes: ['ca (ça)', 'dela (de la)'] },
  suggestion_elliacare: null
};

// -----------------------------------------------------------------------------
// Outils
// -----------------------------------------------------------------------------

let reussis = 0;
async function etape(nom, fn) {
  try {
    await fn();
    reussis++;
    console.log('  ok  ' + nom);
  } catch (e) {
    console.error('  ÉCHEC  ' + nom);
    throw e;
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function lancer(dossier, profil) {
  return chromium.launchPersistentContext(profil, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 400, height: 1000 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${dossier}`, `--load-extension=${dossier}`]
  });
}

async function serviceWorker(contexte) {
  let [sw] = contexte.serviceWorkers();
  if (!sw) sw = await contexte.waitForEvent('serviceworker', { timeout: 15000 });
  return sw;
}

// -----------------------------------------------------------------------------
// 1. L'extension d'origine se charge sans erreur
// -----------------------------------------------------------------------------

async function verifierChargementOrigine() {
  const profil = mkdtempSync(join(tmpdir(), 'profil-origine-'));
  const contexte = await lancer(dossierExtension, profil);
  try {
    const sw = await serviceWorker(contexte);
    const id = new URL(sw.url()).host;
    await etape('Extension d\'origine chargée, service worker actif', async () => {
      assert.match(sw.url(), /background\.js$/);
      const manifeste = await sw.evaluate(() => chrome.runtime.getManifest());
      assert.equal(manifeste.manifest_version, 3);
      assert.deepEqual(manifeste.host_permissions, ['https://api.anthropic.com/*']);
      assert.ok(!JSON.stringify(manifeste).includes('linkedin.com'), 'aucune permission sur linkedin.com');
      const commandes = await sw.evaluate(() => chrome.commands.getAll());
      // Chrome ajoute toujours "_execute_action" (sans raccourci) : on ne compte que les nôtres.
      const noms = commandes.map((c) => c.name).filter((n) => n !== '_execute_action').sort();
      assert.deepEqual(noms, ['capture-commentaire', 'capture-post', 'capture-reponse', 'generer']);
      const raccourcis = Object.fromEntries(commandes.map((c) => [c.name, c.shortcut]));
      console.log('       raccourcis enregistrés par Chromium :', JSON.stringify(raccourcis));
    });
    await etape('Panneau et options s\'ouvrent sans erreur JavaScript', async () => {
      for (const pageNom of ['sidepanel.html', 'options.html']) {
        const page = await contexte.newPage();
        const erreurs = [];
        page.on('pageerror', (e) => erreurs.push(e.message));
        page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
        await page.goto(`chrome-extension://${id}/${pageNom}`);
        await pause(400);
        assert.deepEqual(erreurs, [], pageNom + ' : ' + erreurs.join(' | '));
        await page.close();
      }
    });
  } finally {
    await contexte.close();
    rmSync(profil, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------------
// 2. Parcours complet (copie de test avec accès à la page simulée)
// -----------------------------------------------------------------------------

async function parcoursComplet() {
  const temporaire = mkdtempSync(join(tmpdir(), 'ext-test-'));
  const dossierTest = join(temporaire, 'extension');
  cpSync(dossierExtension, dossierTest, { recursive: true });
  const manifeste = JSON.parse(readFileSync(join(dossierTest, 'manifest.json'), 'utf8'));
  manifeste.host_permissions = [...manifeste.host_permissions, 'http://127.0.0.1/*'];
  writeFileSync(join(dossierTest, 'manifest.json'), JSON.stringify(manifeste, null, 2));

  const serveur = await demarrerServeurPage();
  const port = serveur.address().port;
  const profil = join(temporaire, 'profil');
  const contexte = await lancer(dossierTest, profil);
  const requetesReseau = [];
  contexte.on('request', (r) => requetesReseau.push(r.url()));

  await contexte.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    requetesIA.push({ entetes: req.headers(), corps: JSON.parse(req.postData() || '{}') });
    const suivante = filReponses.shift() || reponseModele(RESULTAT_TYPE);
    await route.fulfill({
      status: suivante.status,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...(suivante.headers || {}) },
      body: suivante.body
    });
  });

  try {
    const sw = await serviceWorker(contexte);
    const id = new URL(sw.url()).host;
    const pageLinkedIn = await contexte.newPage();
    await pageLinkedIn.goto(`http://127.0.0.1:${port}/`);

    const selectionner = (selecteur) => pageLinkedIn.evaluate((s) => {
      const plage = document.createRange();
      plage.selectNodeContents(document.querySelector(s));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(plage);
    }, selecteur);
    const commande = (nom) => sw.evaluate(async ({ nom, port }) => {
      const [onglet] = await chrome.tabs.query({ url: `http://127.0.0.1:${port}/*` });
      await self.gererCommande(nom, onglet);
    }, { nom, port });
    const session = () => sw.evaluate(() => chrome.storage.session.get(null));
    const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));

    await etape('Alt+Shift+1 : la sélection remplit « Post », badge P', async () => {
      await selectionner('#post');
      await commande('capture-post');
      assert.equal((await session()).post, TEXTES.post);
      assert.equal(await badge(), 'P');
    });

    await etape('Alt+Shift+2 puis Alt+Shift+3 : badges PC puis PCR', async () => {
      await selectionner('#commentaire');
      await commande('capture-commentaire');
      assert.equal(await badge(), 'PC');
      await selectionner('#reponse');
      await commande('capture-reponse');
      const s = await session();
      assert.equal(s.commentaire, TEXTES.commentaire);
      assert.equal(s.reponse, TEXTES.reponse);
      assert.equal(await badge(), 'PCR');
    });

    await etape('Sélection vide : rien n\'est écrasé, badge « ! » pendant 2 s', async () => {
      await pageLinkedIn.evaluate(() => window.getSelection().removeAllRanges());
      await commande('capture-post');
      const s = await session();
      assert.equal(s.post, TEXTES.post);
      assert.match(s.erreurCapture.message, /Sélection vide/);
      assert.equal(await badge(), '!');
      await pause(2300);
      assert.equal(await badge(), 'PCR');
    });

    await etape('Sélection dans une zone de saisie lue correctement', async () => {
      await pageLinkedIn.evaluate(() => {
        const zone = document.querySelector('#zone');
        zone.focus();
        zone.setSelectionRange(0, 5);
      });
      const lu = await sw.evaluate(async (port) => {
        const [onglet] = await chrome.tabs.query({ url: `http://127.0.0.1:${port}/*` });
        const [r] = await chrome.scripting.executeScript({ target: { tabId: onglet.id }, func: () => {
          const el = document.activeElement;
          return el.value.substring(el.selectionStart, el.selectionEnd);
        } });
        return r.result;
      }, port);
      assert.equal(lu, 'Texte');
      await pageLinkedIn.evaluate(() => document.activeElement.blur());
    });

    // Panneau ouvert dans un onglet (même code que le panneau latéral).
    const panneau = await contexte.newPage();
    const erreursPanneau = [];
    panneau.on('pageerror', (e) => erreursPanneau.push(e.message));
    await panneau.goto(`chrome-extension://${id}/sidepanel.html`);

    await etape('Panneau : emplacements remplis et mode affiché', async () => {
      assert.equal(await panneau.inputValue('#champ-post'), TEXTES.post);
      assert.equal(await panneau.inputValue('#champ-reponse'), TEXTES.reponse);
      assert.equal(await panneau.textContent('#ligne-mode'), 'Mode : réponse à une réponse');
    });

    await etape('Mise à jour en direct quand un emplacement change', async () => {
      await sw.evaluate(() => chrome.storage.session.set({ reponse: '' }));
      await panneau.waitForFunction(() => document.querySelector('#ligne-mode').textContent === 'Mode : réponse à un commentaire');
      await sw.evaluate((t) => chrome.storage.session.set({ reponse: t }), TEXTES.reponse);
      await panneau.waitForFunction(() => document.querySelector('#ligne-mode').textContent === 'Mode : réponse à une réponse');
    });

    await etape('Sans clé API : message clair, aucun appel', async () => {
      await panneau.click('#btn-generer');
      await panneau.waitForSelector('#message:not([hidden])');
      assert.match(await panneau.textContent('#message'), /Aucune clé API/);
      assert.equal(requetesIA.length, 0);
    });

    await etape('Options : clé enregistrée puis masquée, test de clé OK', async () => {
      const options = await contexte.newPage();
      await options.goto(`chrome-extension://${id}/options.html`);
      await options.fill('#cle-api', 'sk-ant-test-0123456789');
      await options.click('#btn-enregistrer-cle');
      await options.waitForFunction(() => document.querySelector('#etat-cle').textContent.includes('Clé enregistrée'));
      assert.equal(await options.inputValue('#cle-api'), '');
      assert.match(await options.textContent('#etat-cle-enregistree'), /Une clé est enregistrée/);
      assert.ok(!(await options.content()).includes('sk-ant-test-0123456789'), 'clé jamais réaffichée');
      filReponses.push(reponseModele('OK'));
      await options.click('#btn-tester-cle');
      await options.waitForFunction(() => document.querySelector('#etat-cle').textContent.startsWith('OK'));
      const test = requetesIA.pop();
      assert.equal(test.entetes['x-api-key'], 'sk-ant-test-0123456789');
      assert.equal(test.corps.max_tokens, 16);
      const raccourcis = await options.$$eval('#liste-raccourcis kbd', (k) => k.map((e) => e.textContent));
      assert.equal(raccourcis.length, 4);
      await options.close();
    });

    await etape('Pastilles : OCD mémorisé, Autre affiche la précision', async () => {
      await panneau.click('.pastille[data-contexte="Autre"]');
      assert.equal(await panneau.isVisible('#champ-precision'), true);
      await panneau.click('.pastille[data-contexte="OCD"]');
      assert.equal(await panneau.isVisible('#champ-precision'), false);
      assert.equal(await panneau.getAttribute('.pastille[data-contexte="OCD"]', 'aria-pressed'), 'true');
      const local = await sw.evaluate(() => chrome.storage.local.get('contexte'));
      assert.equal(local.contexte, 'OCD');
    });

    await etape('Générer (OCD, lien éteint) : requête conforme et quatre variantes', async () => {
      await panneau.click('#btn-generer');
      await panneau.waitForSelector('#resultats:not([hidden]) .variante');
      const { entetes, corps } = requetesIA.at(-1);
      assert.equal(entetes['x-api-key'], 'sk-ant-test-0123456789');
      assert.equal(entetes['anthropic-version'], '2023-06-01');
      assert.equal(entetes['anthropic-dangerous-direct-browser-access'], 'true');
      assert.equal(entetes['content-type'], 'application/json');
      assert.equal(corps.model, 'claude-sonnet-5-5');
      assert.equal(corps.max_tokens, 1600);
      assert.ok(corps.system.startsWith('Tu écris des commentaires LinkedIn à la place de Franck Lavroff'));
      assert.ok(!corps.system.includes('COMPLEMENT ELLIACARE'), 'pas de complément Elliacare en contexte OCD');
      const message = corps.messages[0].content;
      assert.ok(message.startsWith('CONTEXTE: OCD\nLIEN_ELLIACARE: non\nMODE: reponse_a_reponse\nLONGUEUR: standard\nIRONIE: 1\nHUMOUR: non\nFAUTES: 2\nATTAQUES: reflexion 1 = '));
      assert.match(message, /\nATTAQUES: reflexion 1 = [a-z ]+ \| reflexion 2 = [a-z ]+ \| point_non_vu 1 = [a-z ]+ \| point_non_vu 2 = [a-z ]+\n\nPOST:\n/);
      assert.ok(message.includes('COMMENTAIRE:\n' + TEXTES.commentaire));
      assert.ok(message.endsWith('REPONSE:\n' + TEXTES.reponse));

      const etiquettes = await panneau.$$eval('.variante .etiquette', (e) => e.map((x) => x.textContent));
      assert.deepEqual(etiquettes, ['Réflexion 1', 'Réflexion 2', 'Point non vu 1', 'Point non vu 2'], 'humour décoché : pas de bloc Humour');
      const textes = await panneau.$$eval('.variante-texte', (e) => e.map((x) => x.textContent));
      for (const t of textes) {
        assert.ok(!t.includes(TIRET_LONG), 'pas de tiret long');
        assert.ok(!/;(?!-\))/.test(t), 'pas de point-virgule hors smiley');
      }
      assert.ok(textes[2].includes('voeu pieux, on oublie le lendemain'));
      assert.ok(textes[2].includes('temps protégé. Pas sur le catalogue'));
      assert.ok(textes[0].endsWith(';-)'));
      const fautes = await panneau.$$eval('.variante .fautes', (e) => e.map((x) => x.textContent));
      assert.deepEqual(fautes, [
        'Fautes volontaires : ca (ça), enfait (en fait)',
        'Fautes volontaires : a (à), meme (même)',
        'Fautes volontaires : voeu (vœu), tres (très)',
        'Fautes volontaires : aprés (après), parceque (parce que)'
      ]);
      assert.equal(await panneau.isVisible('.avertissement'), false, 'aucun avertissement sur un résultat conforme');
      assert.equal(await panneau.isVisible('.variante.suggestion'), false);
      const style = await panneau.$eval('.variante-texte', (e) => getComputedStyle(e).whiteSpace);
      assert.equal(style, 'pre-wrap');
      const opacite = await panneau.$eval('.btn-copier', (e) => getComputedStyle(e).opacity);
      assert.equal(opacite, '0.35');
    });

    await etape('Copie : texte seul copié, coche pendant 1,2 s', async () => {
      // Espion sur l'écriture dans le presse-papiers (la lecture n'est pas autorisée à l'extension).
      await panneau.evaluate(() => {
        const original = navigator.clipboard.writeText.bind(navigator.clipboard);
        window.__copies = [];
        navigator.clipboard.writeText = (t) => { window.__copies.push(t); return original(t); };
      });
      const attendu = await panneau.$eval('.variante-texte', (e) => e.textContent);
      await panneau.click('.variante .btn-copier');
      await panneau.waitForSelector('.btn-copier.copie');
      const presse = await panneau.evaluate(() => window.__copies.at(-1));
      assert.equal(presse, attendu);
      assert.ok(!presse.includes('Fautes volontaires'));
      assert.equal(await panneau.getAttribute('.btn-copier.copie', 'aria-label'), 'Copié');
      await pause(1400);
      assert.equal(await panneau.$('.btn-copier.copie'), null);
    });

    await etape('Contexte Elliacare : complément ajouté au prompt système', async () => {
      await panneau.click('.pastille[data-contexte="Elliacare"]');
      filReponses.push(reponseModele({ ...RESULTAT_TYPE, suggestion_elliacare: 'Chez Elliacare, on part du terrain avant de parler outil.' }));
      await panneau.click('#btn-generer');
      await panneau.waitForSelector('.variante.suggestion');
      const { corps } = requetesIA.at(-1);
      assert.ok(corps.system.includes('COMPLEMENT ELLIACARE'));
      assert.ok(corps.messages[0].content.startsWith('CONTEXTE: Elliacare\nLIEN_ELLIACARE: non'));
      assert.equal(await panneau.textContent('.variante.suggestion .etiquette'), 'Placement Elliacare (optionnel)');
      assert.equal(await panneau.isVisible('.variante.suggestion .btn-copier'), true);
    });

    await etape('Lien Elliacare actif en contexte OCD : LIEN_ELLIACARE oui et complément', async () => {
      await panneau.click('.pastille[data-contexte="OCD"]');
      await panneau.click('.interrupteur:has(#lien-elliacare)');
      assert.equal(await panneau.isChecked('#lien-elliacare'), true);
      await panneau.click('#btn-generer');
      await panneau.waitForFunction(() => !document.querySelector('#btn-generer').disabled);
      const { corps } = requetesIA.at(-1);
      assert.ok(corps.messages[0].content.startsWith('CONTEXTE: OCD\nLIEN_ELLIACARE: oui'));
      assert.ok(corps.system.includes('COMPLEMENT ELLIACARE'));
      await panneau.click('.interrupteur:has(#lien-elliacare)');
    });

    await etape('Régénérer : relance avec les mêmes entrées', async () => {
      const avant = requetesIA.length;
      await panneau.click('#btn-regenerer');
      await panneau.waitForFunction(() => !document.querySelector('#btn-generer').disabled);
      assert.equal(requetesIA.length, avant + 1);
      const sansAttaques = (r) => r.corps.messages[0].content.replace(/\nATTAQUES: [^\n]*/, '');
      assert.equal(sansAttaques(requetesIA.at(-1)), sansAttaques(requetesIA.at(-2)));
    });

    await etape('Flash, ironie 2, humour coché : transmis, mémorisés, bloc Humour en tête', async () => {
      await panneau.click('[data-longueur="flash"]');
      await panneau.click('[data-ironie="2"]');
      await panneau.click('.interrupteur:has(#humour)');
      assert.equal(await panneau.isChecked('#humour'), true);
      const reglages = await sw.evaluate(() => chrome.storage.local.get(['format', 'ironie', 'humour']));
      assert.deepEqual(reglages, { format: 'flash', ironie: 2, humour: true });
      const flash = {
        ...RESULTAT_TYPE,
        variantes: [
          { angle: 'reflexion', texte: 'Un cadre non lu, c\'est deja un cadre perdu.', fautes: ['deja (déjà)', 'enfait (en fait)'] },
          { angle: 'reflexion', texte: 'J\'avoue : je signe les chartes sans les lire ;-)', fautes: ['a (à)', 'ca (ça)'] },
          { angle: 'point_non_vu', texte: 'La formation veut un créneau, pas un voeu.', fautes: ['voeu (vœu)', 'tres (très)'] },
          { angle: 'point_non_vu', texte: 'Sans agenda protégé, l\'urgence gagne a chaque fois.', fautes: ['a (à)', 'dela (de la)'] }
        ]
      };
      filReponses.push(reponseModele(flash));
      const avant = requetesIA.length;
      await panneau.click('#btn-generer');
      await panneau.waitForSelector('.variante.humour');
      assert.equal(requetesIA.length, avant + 1, 'résultat conforme : pas de réécriture');
      const message = requetesIA.at(-1).corps.messages[0].content;
      assert.ok(message.includes('\nLONGUEUR: flash\nIRONIE: 2\nHUMOUR: oui\nFAUTES: 2\n'));
      const etiquettes = await panneau.$$eval('.variante .etiquette', (e) => e.map((x) => x.textContent));
      assert.deepEqual(etiquettes, ['Humour', 'Réflexion 1', 'Réflexion 2', 'Point non vu 1', 'Point non vu 2']);
      const fautes = await panneau.$$eval('.variante .fautes', (e) => e.map((x) => x.textContent));
      assert.ok(fautes.every((f) => !f.includes('attendu')), 'deux fautes par commentaire');
      assert.equal(await panneau.isVisible('.avertissement'), false);
      await panneau.reload();
      assert.equal(await panneau.getAttribute('[data-longueur="flash"]', 'aria-pressed'), 'true');
      assert.equal(await panneau.getAttribute('[data-ironie="2"]', 'aria-pressed'), 'true');
      assert.equal(await panneau.isChecked('#humour'), true);
      // Retour aux réglages par défaut pour la suite
      await panneau.click('[data-longueur="standard"]');
      await panneau.click('[data-ironie="1"]');
      await panneau.click('.interrupteur:has(#humour)');
    });

    await etape('Option 3 fautes : transmise, mémorisée, écart signalé sous chaque commentaire', async () => {
      assert.equal(await panneau.isChecked('#trois-fautes'), false, '2 fautes par défaut');
      await panneau.click('.interrupteur:has(#trois-fautes)');
      assert.deepEqual(await sw.evaluate(() => chrome.storage.local.get('troisFautes')), { troisFautes: true });
      await panneau.click('#btn-generer');
      await panneau.waitForFunction(() => !document.querySelector('#btn-generer').disabled);
      assert.ok(requetesIA.at(-1).corps.messages[0].content.includes('\nFAUTES: 3\n'));
      const fautes = await panneau.$$eval('.variante .fautes', (e) => e.map((x) => x.textContent));
      assert.ok(fautes.every((f) => f.endsWith('(attendu : 3)')), 'le modèle factice n\'en met que 2');
      await panneau.click('.interrupteur:has(#trois-fautes)');
    });

    await etape('Phrase trop longue : réécriture automatique', async () => {
      const longue = {
        ...RESULTAT_TYPE,
        variantes: RESULTAT_TYPE.variantes.map((v, i) => i === 2 ? { ...v, texte: 'Je pense que la formation des équipes soignantes reste le premier levier qui permet vraiment de sécuriser les usages.' } : v)
      };
      filReponses.push(reponseModele(longue), reponseModele(RESULTAT_TYPE));
      const avant = requetesIA.length;
      await panneau.click('#btn-generer');
      await panneau.waitForFunction(() => !document.querySelector('#btn-generer').disabled);
      assert.equal(requetesIA.length, avant + 2);
      assert.match(requetesIA.at(-1).corps.messages[2].content, /Réflexion 2 : une phrase de \d+ mots, 12 mots maximum/);
      assert.equal(await panneau.isVisible('.avertissement'), false);
    });

    await etape('Formule toute faite détectée : réécriture automatique, fil de conversation transmis', async () => {
      const fautif = {
        ...RESULTAT_TYPE,
        variantes: RESULTAT_TYPE.variantes.map((v, i) => i === 1 ? { ...v, texte: 'Ce qui me frappe, c\'est un point qu\'on oublie souvent.\nLe cadre ne suffit pas.' } : v)
      };
      filReponses.push(reponseModele(fautif), reponseModele(RESULTAT_TYPE));
      const avant = requetesIA.length;
      await panneau.click('#btn-generer');
      await panneau.waitForFunction(() => !document.querySelector('#btn-generer').disabled && document.querySelectorAll('.variante').length === 4);
      assert.equal(requetesIA.length, avant + 2);
      const correction = requetesIA.at(-1).corps.messages;
      assert.equal(correction.length, 3);
      assert.deepEqual(correction.map((m) => m.role), ['user', 'assistant', 'user']);
      assert.match(correction[2].content, /Réflexion 1 : contient « ce qui me frappe », « qu'on oublie souvent »/);
      const textes = await panneau.$$eval('.variante-texte', (e) => e.map((x) => x.textContent.toLowerCase()));
      assert.ok(textes.every((t) => !t.includes('ce qui me frappe')));
      assert.match(await panneau.textContent('#info-cas'), /Réécriture automatique/);
    });

    await etape('Formule toujours présente après réécriture : avertissement visible', async () => {
      const fautif = {
        ...RESULTAT_TYPE,
        variantes: RESULTAT_TYPE.variantes.map((v, i) => i === 0 ? { ...v, texte: 'Le plus frappant, c\'est la vitesse.' } : v)
      };
      filReponses.push(reponseModele(fautif), reponseModele(fautif));
      await panneau.click('#btn-generer');
      await panneau.waitForSelector('.avertissement:not([hidden])');
      assert.match(await panneau.textContent('.avertissement:not([hidden])'), /formule toute faite « le plus frappant »/);
    });

    await etape('JSON invalide : une relance avec consigne, puis texte brut', async () => {
      const avant = requetesIA.length;
      filReponses.push(reponseModele('Voici ma réponse sans JSON ; désolé.'), reponseModele('Toujours pas de JSON.'));
      await panneau.click('#btn-generer');
      await panneau.waitForSelector('.variante.brut');
      assert.equal(requetesIA.length, avant + 2);
      assert.ok(requetesIA.at(-1).corps.messages[0].content.endsWith('Réponds uniquement avec le JSON demandé, sans aucun texte autour.'));
      assert.match(await panneau.textContent('#message'), /hors format/);
      assert.equal(await panneau.isVisible('.variante.brut .btn-copier'), true);
    });

    await etape('JSON invalide puis valide : variantes affichées', async () => {
      filReponses.push(reponseModele('pas du json'), reponseModele(RESULTAT_TYPE));
      await panneau.click('#btn-generer');
      await panneau.waitForFunction(() => document.querySelectorAll('.variante:not(.brut)').length === 4);
    });

    await etape('Erreurs : clé refusée (401) et limite de débit (429)', async () => {
      filReponses.push({ status: 401, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
      await panneau.click('#btn-generer');
      await panneau.waitForFunction(() => /Clé API refusée/.test(document.querySelector('#message').textContent));
      filReponses.push({ status: 429, headers: { 'retry-after': '7' }, body: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'rate' } }) });
      await panneau.click('#btn-generer');
      await panneau.waitForFunction(() => /Limite de débit atteinte. Réessayez dans 7 s/.test(document.querySelector('#message').textContent));
    });

    await etape('Combinaison invalide (Réponse sans Commentaire) : génération bloquée', async () => {
      const avant = requetesIA.length;
      await panneau.click('[data-vider="commentaire"]');
      assert.equal(await panneau.textContent('#ligne-mode'), 'Mode : combinaison invalide');
      await panneau.click('#btn-generer');
      assert.match(await panneau.textContent('#message'), /Une Réponse a besoin du Commentaire/);
      assert.equal(requetesIA.length, avant);
      assert.equal((await session()).commentaire, '');
      assert.equal(await badge(), 'PR');
    });

    await etape('Commentaire seul : mode « sans le post »', async () => {
      await panneau.click('#btn-tout-vider');
      await panneau.fill('#champ-commentaire', 'Super post, merci !');
      assert.equal(await panneau.textContent('#ligne-mode'), 'Mode : réponse à un commentaire, sans le post');
      await panneau.click('#btn-generer');
      await panneau.waitForFunction(() => !document.querySelector('#btn-generer').disabled);
      assert.ok(requetesIA.at(-1).corps.messages[0].content.includes('MODE: reponse_sans_contexte'));
      assert.ok(!requetesIA.at(-1).corps.messages[0].content.includes('POST:'));
      await pause(400);
      assert.equal((await session()).commentaire, 'Super post, merci !', 'saisie manuelle sauvegardée');
    });

    await etape('Touche Entrée (hors zone de texte) : génération', async () => {
      const avant = requetesIA.length;
      await panneau.click('#ligne-mode');
      await panneau.keyboard.press('Enter');
      await panneau.waitForFunction((n) => !document.querySelector('#btn-generer').disabled, avant);
      await pause(300);
      assert.equal(requetesIA.length, avant + 1);
    });

    await etape('Raccourci Générer (Alt+Shift+G) : le panneau lance la génération', async () => {
      const avant = requetesIA.length;
      await commande('generer');
      await pause(1200);
      assert.equal(requetesIA.length, avant + 1);
    });

    await etape('Contexte mémorisé après réouverture du panneau', async () => {
      await panneau.reload();
      assert.equal(await panneau.getAttribute('.pastille[data-contexte="OCD"]', 'aria-pressed'), 'true');
    });

    await etape('Aucune erreur JavaScript, aucun appel réseau hors point d\'accès IA', async () => {
      assert.deepEqual(erreursPanneau, []);
      const externes = requetesReseau.filter((u) => !u.startsWith('chrome-extension://') && !u.startsWith(`http://127.0.0.1:${port}`) && !u.startsWith('https://api.anthropic.com/'));
      assert.deepEqual(externes, []);
      const pageIntacte = await pageLinkedIn.evaluate(() => document.querySelector('#post').textContent);
      assert.equal(pageIntacte, TEXTES.post, 'la page n\'a pas été modifiée');
    });

    // Captures d'écran pour contrôle visuel
    mkdirSync(dossierCaptures, { recursive: true });
    await sw.evaluate((t) => chrome.storage.session.set({ ...t, erreurCapture: null }), TEXTES);
    filReponses.push(reponseModele({ ...RESULTAT_TYPE, suggestion_elliacare: 'L\'IA assiste, le clinicien décide : encore faut-il lui laisser le temps de se former.' }));
    await panneau.reload();
    await panneau.click('.interrupteur:has(#humour)');
    await panneau.click('#btn-generer');
    await panneau.waitForSelector('.variante.suggestion');
    await panneau.screenshot({ path: join(dossierCaptures, 'panneau-clair.png'), fullPage: true });
    await panneau.emulateMedia({ colorScheme: 'dark' });
    await panneau.screenshot({ path: join(dossierCaptures, 'panneau-sombre.png'), fullPage: true });
  } finally {
    await contexte.close();
    serveur.close();
    rmSync(temporaire, { recursive: true, force: true });
  }
}

await verifierChargementOrigine();
await parcoursComplet();
console.log(`\n${reussis} étapes de bout en bout réussies.`);
