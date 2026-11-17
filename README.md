# add-Linkedin-comm

Extension Chrome personnelle **Réponses LinkedIn** : capture au clavier un texte sélectionné sur LinkedIn (post, commentaire, réponse), puis propose deux réponses prêtes à coller, une en mode "réflexion", l'autre en mode "point non vu".

- Extension (à charger telle quelle dans Chrome) : [`extension-reponses-linkedin/`](extension-reponses-linkedin/)
- Guide complet (installation, clé API, raccourcis, usage, dépannage) : [`extension-reponses-linkedin/README.md`](extension-reponses-linkedin/README.md)

## Contenu du dépôt

```text
extension-reponses-linkedin/   l'extension (Manifest V3, JavaScript natif, aucune étape de build)
site/                          page d'installation publiée sur Vercel
api/proxy.js                   proxy optionnel (fonction Vercel) qui garde la clé API côté serveur
scripts/empaqueter.js          crée site/extension-reponses-linkedin.zip (lancé aussi par Vercel)
scripts/generer-icones.py      régénère les icônes
tests/                         tests unitaires, tests du proxy, test de bout en bout (Playwright)
vercel.json                    configuration du déploiement Vercel
```

## Installation rapide

1. Téléchargez le `.zip` depuis la page Vercel du projet (ou clonez ce dépôt).
2. `chrome://extensions`, activez le **Mode développeur**, puis **Charger l'extension non empaquetée** et choisissez le dossier `extension-reponses-linkedin`.
3. Options de l'extension : collez la clé API Anthropic, **Enregistrer**, **Tester la clé**.
4. Sur LinkedIn : sélectionnez un post puis `Alt+Shift+1`, choisissez un contexte, **Générer**.

## Déploiement Vercel

- Commande de build : `node scripts/empaqueter.js` (crée l'archive de l'extension dans `site/`).
- Dossier publié : `site/`.
- Fonction : `api/proxy.js`, inactive tant que `ANTHROPIC_API_KEY` et `PROXY_TOKEN` ne sont pas définies dans les variables d'environnement du projet.
- Les pages sont servies avec `X-Robots-Tag: noindex` (pas d'indexation par les moteurs de recherche).

## Tests

Prérequis : Node.js 20 ou plus, et Playwright avec Chromium pour le test de bout en bout.

```bash
npm test
```

- `tests/tests-unitaires.js` : mode déduit, gabarit du message, corps de requête, nettoyage (tiret long, point-virgule), lecture du JSON.
- `tests/test-proxy.js` : jeton, CORS, plafonds et transmission de la fonction proxy (faux service IA).
- `tests/test-extension.js` : charge l'extension dans Chromium, simule les captures et la génération avec un faux service IA, vérifie le rendu, la copie, les erreurs et l'absence d'appels réseau parasites.
