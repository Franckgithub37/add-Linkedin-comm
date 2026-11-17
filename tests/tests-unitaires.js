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
test('Gabarit complet', () => {
  const m = IA.construireMessageUtilisateur({ contexte: 'OCD', lienElliacare: false, mode: 'reponse_a_reponse', post: ' P ', commentaire: 'C', reponse: 'R' });
  assert.equal(m, 'CONTEXTE: OCD\nLIEN_ELLIACARE: non\nMODE: reponse_a_reponse\n\nPOST:\nP\n\nCOMMENTAIRE:\nC\n\nREPONSE:\nR');
});
test('Champs vides omis', () => {
  const m = IA.construireMessageUtilisateur({ contexte: 'IA', lienElliacare: true, mode: 'reponse_sans_contexte', post: '', commentaire: 'C', reponse: '' });
  assert.equal(m, 'CONTEXTE: IA\nLIEN_ELLIACARE: oui\nMODE: reponse_sans_contexte\n\nCOMMENTAIRE:\nC');
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
  assert.equal(c.max_tokens, 900);
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
    { angle: 'reflexion', texte: 'A ; a', fautes: ['meme', 'a'] }
  ],
  suggestion_elliacare: null
};
test('JSON entouré de balises de code', () => {
  const o = IA.analyserJson('```json\n' + JSON.stringify(exemple) + '\n```');
  assert.equal(o.cas, 'standard');
});
test('JSON entouré de texte', () => assert.ok(IA.analyserJson('Voici : ' + JSON.stringify(exemple) + ' fin')));
test('Texte non JSON', () => assert.equal(IA.analyserJson('pas de json ici'), null));
test('Ordre réflexion puis point non vu, textes nettoyés', () => {
  const r = IA.normaliserResultat(exemple);
  assert.equal(r.variantes[0].angle, 'reflexion');
  assert.equal(r.variantes[0].texte, 'A. A');
  assert.equal(r.variantes[1].texte, 'B, b');
  assert.deepEqual([...r.variantes[0].fautes], ['meme', 'a']);
  assert.equal(r.suggestion, null);
});
test('Suggestion Elliacare conservée', () => {
  const r = IA.normaliserResultat({ ...exemple, suggestion_elliacare: 'Chez Elliacare, on part du terrain.' });
  assert.equal(r.suggestion, 'Chez Elliacare, on part du terrain.');
});
test('Structure invalide refusée', () => assert.equal(IA.normaliserResultat({ variantes: [] }), null));

console.log('Expressions proscrites');
test('Détection de "bravo"', () => assert.deepEqual([...IA.expressionsProscrites('Bravo pour ce post')], ['bravo']));

console.log(`\n${reussis} tests unitaires réussis.`);
