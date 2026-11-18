// Tests unitaires de ia.js (logique pure), sans navigateur.
// Usage : node tests/tests-unitaires.js

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(join(racine, 'extension-reponses-linkedin', 'ia.js'), 'utf8');
const contexte = { self: {}, console };
vm.runInNewContext(code, contexte);
const IA = contexte.self.IA;

let reussis = 0;
function test(nom, fn) {
  try {
    fn();
    reussis++;
    console.log('  ok  ' + nom);
  } catch (e) {
    console.error('  ÉCHEC  ' + nom);
    throw e;
  }
}

const TIRET_LONG = '\u2014';

console.log('Mode déduit des emplacements');
test('Post seul', () => assert.equal(IA.determinerMode('a', '', '').mode, 'commentaire_sur_post'));
test('Post + Commentaire', () => assert.equal(IA.determinerMode('a', 'b', '').mode, 'reponse_a_commentaire'));
test('Post + Commentaire + Réponse', () => assert.equal(IA.determinerMode('a', 'b', 'c').mode, 'reponse_a_reponse'));
test('Commentaire seul', () => assert.equal(IA.determinerMode('', 'b', '').mode, 'reponse_sans_contexte'));
test('Réponse sans Commentaire : invalide', () => {
  const r = IA.determinerMode('a', '', 'c');
  assert.equal(r.valide, false);
  assert.match(r.message, /Commentaire/);
});
test('Réponse seule : invalide', () => assert.equal(IA.determinerMode('', '', 'c').valide, false));
test('Commentaire + Réponse sans Post : invalide', () => assert.equal(IA.determinerMode('', 'b', 'c').valide, false));
test('Rien : invalide avec message', () => {
  const r = IA.determinerMode(' ', '\n', '');
  assert.equal(r.valide, false);
  assert.match(r.message, /Aucun emplacement/);
});
test('Libellé affiché', () => assert.equal(IA.determinerMode('a', 'b', '').libelle, 'Mode : réponse à un commentaire'));

console.log('Message utilisateur');
test('Gabarit complet avec longueur, ironie, humour et attaques', () => {
  const m = IA.construireMessageUtilisateur({
    contexte: 'OCD', lienElliacare: false, mode: 'reponse_a_reponse', post: ' P ', commentaire: 'C', reponse: 'R',
    longueur: 'flash', ironie: 2, humour: true, nbFautes: 3, attaques: ['aveu', 'question', 'chute', 'image de terrain']
  });
  assert.equal(m, 'CONTEXTE: OCD\nLIEN_ELLIACARE: non\nMODE: reponse_a_reponse\nLONGUEUR: flash\nIRONIE: 2\nHUMOUR: oui\nFAUTES: 3\n'
    + 'ATTAQUES: reflexion 1 = aveu | reflexion 2 = question | point_non_vu 1 = chute | point_non_vu 2 = image de terrain'
    + '\n\nPOST:\nP\n\nCOMMENTAIRE:\nC\n\nREPONSE:\nR');
});
test('Champs vides omis, réglages par défaut', () => {
  const m = IA.construireMessageUtilisateur({ contexte: 'IA', lienElliacare: true, mode: 'reponse_sans_contexte', post: '', commentaire: 'C', reponse: '' });
  assert.equal(m, 'CONTEXTE: IA\nLIEN_ELLIACARE: oui\nMODE: reponse_sans_contexte\nLONGUEUR: standard\nIRONIE: 1\nHUMOUR: non\nFAUTES: 2\n\nCOMMENTAIRE:\nC');
});
test('Ironie 0 conservée (pas remplacée par la valeur par défaut)', () => {
  const m = IA.construireMessageUtilisateur({ contexte: 'IA', mode: 'commentaire_sur_post', post: 'P', ironie: 0 });
  assert.ok(m.includes('\nIRONIE: 0\n'));
});
test('Tirage des attaques : quatre attaques différentes', () => {
  for (let i = 0; i < 20; i++) {
    const a = IA.tirerAttaques();
    assert.equal(a.length, 4);
    assert.equal(new Set(a).size, 4);
    a.forEach((x) => assert.ok(IA.ATTAQUES.includes(x)));
  }
});
test('Autre avec précision', () => {
  const m = IA.construireMessageUtilisateur({ contexte: 'Autre', precision: ' juridique ', lienElliacare: false, mode: 'commentaire_sur_post', post: 'P' });
  assert.ok(m.startsWith('CONTEXTE: Autre: juridique\n'));
});
test('Autre sans précision', () => {
  const m = IA.construireMessageUtilisateur({ contexte: 'Autre', precision: '', lienElliacare: false, mode: 'commentaire_sur_post', post: 'P' });
  assert.ok(m.startsWith('CONTEXTE: Autre\n'));
});

console.log('Corps de requête');
test('Sonnet 5.5 : réflexion coupée et repli serveur', () => {
  const c = IA.construireCorps({ systeme: 'S', messageUtilisateur: 'U', modele: 'claude-sonnet-5-5' });
  assert.equal(c.model, 'claude-sonnet-5-5');
  assert.equal(c.max_tokens, 1600);
  assert.equal(c.system, 'S');
  assert.deepEqual(JSON.parse(JSON.stringify(c.messages)), [{ role: 'user', content: 'U' }]);
  assert.equal(c.thinking.type, 'between_tools');
  assert.equal(c.fallbacks, 'default');
});
test('Haiku 5.5 : réflexion désactivée, pas de repli', () => {
  const c = IA.construireCorps({ systeme: 'S', messageUtilisateur: 'U', modele: 'claude-haiku-5-5' });
  assert.equal(c.thinking.type, 'disabled');
  assert.equal(c.fallbacks, undefined);
});
test('Modèle inconnu : corps minimal', () => {
  const c = IA.construireCorps({ systeme: 'S', messageUtilisateur: 'U', modele: 'claude-autre-1' });
  assert.deepEqual(Object.keys(c).sort(), ['max_tokens', 'messages', 'model', 'system']);
});

console.log('Complément Elliacare');
test('Fichier avec seulement un commentaire = vide', () => assert.equal(IA.nettoyerComplement('<!-- en-tête -->\n\n  '), ''));
test('Commentaire retiré, contenu gardé', () => assert.equal(IA.nettoyerComplement('<!-- x -->\nTexte'), 'Texte'));

console.log('Nettoyage du texte');
test('Tiret long remplacé par une virgule', () => {
  assert.equal(IA.nettoyerTexte('On gagne du temps ' + TIRET_LONG + ' et pourtant on perd le fil.'), 'On gagne du temps, et pourtant on perd le fil.');
});
test('Tiret long collé', () => assert.equal(IA.nettoyerTexte('mot' + TIRET_LONG + 'suite'), 'mot, suite'));
test('Tiret long avant un point', () => assert.equal(IA.nettoyerTexte('fin ' + TIRET_LONG + '.'), 'fin.'));
test('Point-virgule remplacé par un point avec majuscule', () => {
  assert.equal(IA.nettoyerTexte('Le modèle propose ; le soignant décide.'), 'Le modèle propose. Le soignant décide.');
});
test('Smiley ;-) conservé', () => assert.equal(IA.nettoyerTexte('Bref, on verra ;-)'), 'Bref, on verra ;-)'));
test('Tiret moyen entre nombres conservé', () => assert.equal(IA.nettoyerTexte('2020\u20132024'), '2020\u20132024'));
test('Double saut de ligne réduit', () => assert.equal(IA.nettoyerTexte('A\n\n\nB'), 'A\nB'));
test('Aucun tiret long ni point-virgule résiduel', () => {
  const s = IA.nettoyerTexte('a ' + TIRET_LONG + ' b; c ;d ;-) e' + TIRET_LONG);
  assert.ok(!s.includes(TIRET_LONG));
  assert.ok(!/;(?!-\))/.test(s));
});

console.log('Lecture du JSON');
const exemple = {
  mode: 'commentaire_sur_post',
  cas: 'standard',
  variantes: [
    { angle: 'point_non_vu', texte: 'B ' + TIRET_LONG + ' b', fautes: ['ca'] },
    { angle: 'reflexion', texte: 'A ; a', fautes: ['meme', 'a'] },
    { angle: 'reflexion', texte: 'A2', fautes: ['x', 'y'] },
    { angle: 'point non vu', texte: 'B2', fautes: ['z', 'w'] }
  ],
  humour: { texte: 'Une blague courte', fautes: ['ca (ça)'] },
  suggestion_elliacare: null
};
test('JSON entouré de balises de code', () => {
  const o = IA.analyserJson('```json\n' + JSON.stringify(exemple) + '\n```');
  assert.equal(o.cas, 'standard');
});
test('JSON entouré de texte', () => assert.ok(IA.analyserJson('Voici : ' + JSON.stringify(exemple) + ' fin')));
test('Texte non JSON', () => assert.equal(IA.analyserJson('pas de json ici'), null));
test('Quatre variantes : deux réflexions puis deux points non vus, textes nettoyés', () => {
  const r = IA.normaliserResultat(exemple);
  assert.deepEqual([...r.variantes.map((v) => IA.libelleVariante(v))], ['Réflexion 1', 'Réflexion 2', 'Point non vu 1', 'Point non vu 2']);
  assert.equal(r.variantes[0].texte, 'A. A');
  assert.equal(r.variantes[2].texte, 'B, b');
  assert.deepEqual([...r.variantes[0].fautes], ['meme', 'a']);
  assert.equal(r.humour.texte, 'Une blague courte');
  assert.equal(r.suggestion, null);
});
test('Humour absent : null', () => {
  const r = IA.normaliserResultat({ ...exemple, humour: null });
  assert.equal(r.humour, null);
});
test('Suggestion Elliacare conservée', () => {
  const r = IA.normaliserResultat({ ...exemple, suggestion_elliacare: 'Chez Elliacare, on part du terrain.' });
  assert.equal(r.suggestion, 'Chez Elliacare, on part du terrain.');
});
test('Structure invalide refusée', () => assert.equal(IA.normaliserResultat({ variantes: [] }), null));

console.log('Formules toutes faites et contrôles');
test('Détection de "bravo"', () => assert.deepEqual([...IA.expressionsProscrites('Bravo pour ce post')], ['bravo']));
test('Détection des tics signalés (accents et apostrophes typographiques)', () => {
  const f = IA.formulesToutesFaites('Ce qui me frappe… Un point qu\u2019on oublie souvent. Ce qu\u2019on ne dit pas. Le plus frappant.');
  for (const attendu of ['ce qui me frappe', "qu'on oublie souvent", "ce qu'on ne dit pas", 'le plus frappant']) {
    assert.ok(f.includes(attendu), attendu);
  }
});
test('Texte personnel sans formule : rien à signaler', () => {
  assert.deepEqual([...IA.formulesToutesFaites('Moi je parie que le cadre existe deja, mais personne ne la lu.')], []);
});
test('Formats : flash 1 ligne de 90 caractères, court 2 lignes, standard 3 lignes', () => {
  assert.equal(IA.controlerTexte('Une ligne nette.', [], 'flash', false).tropLong, false);
  assert.equal(IA.controlerTexte('Ligne 1.\nLigne 2.', [], 'flash', false).tropLong, true);
  assert.equal(IA.controlerTexte('a '.repeat(60), [], 'flash', false).tropLong, true, '120 caractères en flash : trop long');
  assert.equal(IA.controlerTexte('Ligne 1.\nLigne 2.', [], 'court', false).tropLong, false);
  assert.equal(IA.controlerTexte('L1.\nL2.\nL3.', [], 'court', false).tropLong, true);
  assert.equal(IA.controlerTexte('L1.\nL2.\nL3.', [], 'standard', false).tropLong, false);
  assert.equal(IA.controlerTexte('L1.\nL2.\nL3.\nL4.', [], 'standard', false).tropLong, true);
});
test('Phrases courtes : une grande phrase est signalée', () => {
  const longue = 'Je pense que la formation des équipes soignantes reste le premier levier qui permet vraiment de sécuriser les usages.';
  assert.equal(IA.controlerTexte(longue, [], 'standard', false).phraseTropLongue, true);
  assert.equal(IA.controlerTexte('Je parie sur le temps protégé. Pas sur le catalogue.', [], 'standard', false).phraseTropLongue, false);
});
test('Fautes : deux par défaut, trois en option, quelle que soit la longueur', () => {
  assert.equal(IA.controlerTexte('x', ['a', 'b'], 'flash', false).fautesAttendues, 2);
  assert.equal(IA.controlerTexte('x', ['a', 'b'], 'standard', false).fautesOk, true);
  assert.equal(IA.controlerTexte('x', ['a', 'b'], 'standard', false, 3).fautesOk, false);
  assert.equal(IA.controlerTexte('x', ['a', 'b', 'c'], 'court', false, 3).fautesOk, true);
  assert.equal(IA.controlerTexte('x', ['a', 'b'], 'flash', true).fautesAttendues, 2, 'humour : même règle');
});
test('Problèmes à réécrire : formule interdite et humour manquant', () => {
  const r = IA.normaliserResultat({ ...exemple, humour: null, variantes: exemple.variantes.map((v, i) => i === 1 ? { ...v, texte: 'Ce qui me frappe, c\'est ca.' } : v) });
  const p = IA.problemesARecrire(r, { longueur: 'standard', humour: true });
  assert.equal(p.length, 2);
  assert.match(p[0], /Réflexion 1 : contient « ce qui me frappe »/);
  assert.match(p[1], /humour/);
  assert.match(IA.messageCorrection(p), /^Réécris le JSON complet/);
});
test('Résultat conforme : aucune réécriture', () => {
  assert.deepEqual([...IA.problemesARecrire(IA.normaliserResultat(exemple), { longueur: 'standard', humour: true })], []);
});
test('Problèmes à réécrire : phrase trop longue', () => {
  const longue = 'Je pense que la formation des équipes soignantes reste le premier levier qui permet vraiment de sécuriser les usages.';
  const r = IA.normaliserResultat({ ...exemple, variantes: exemple.variantes.map((v, i) => i === 3 ? { ...v, texte: longue } : v) });
  const p = IA.problemesARecrire(r, { longueur: 'standard', humour: false });
  assert.equal(p.length, 1);
  assert.match(p[0], /Point non vu 2 : une phrase de \d+ mots, 12 mots maximum/);
});

console.log(`\n${reussis} tests unitaires réussis.`);
