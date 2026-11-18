# Réponses LinkedIn - extension Chrome personnelle

Depuis LinkedIn, l'extension permet de :

1. capturer au clavier un texte sélectionné (le post, un commentaire, une réponse dans un fil) ;
2. choisir un contexte (Elliacare, OCD, IA, Autre) ;
3. obtenir quatre commentaires courts prêts à poster, écrits dans la voix de Franck : deux en mode "réflexion", deux en mode "point non vu", plus une ligne d'humour si la case est cochée ;
4. copier le commentaire choisi d'un clic sur une petite icône, puis le coller soi-même dans LinkedIn.

Usage strictement personnel. L'extension n'est pas publiée sur le Chrome Web Store.

Ce que l'extension ne fait pas : elle ne lit pas la page automatiquement, n'injecte rien dans LinkedIn, ne clique sur rien et ne publie rien. Sa seule action sur la page est de lire la sélection de texte au moment où vous appuyez sur un raccourci.

---

## 1. Installation en mode développeur

Prérequis : Google Chrome 116 ou plus récent (ou un navigateur Chromium équivalent).

1. Récupérez le dossier `extension-reponses-linkedin/` :
   - soit en téléchargeant l'archive `.zip` depuis la page d'installation (Vercel) puis en la décompressant ;
   - soit en clonant le dépôt GitHub.
2. Ouvrez `chrome://extensions`.
3. Activez le **Mode développeur** (interrupteur en haut à droite).
4. Cliquez sur **Charger l'extension non empaquetée** et sélectionnez le dossier `extension-reponses-linkedin` (celui qui contient `manifest.json`).
5. L'extension "Réponses LinkedIn" apparaît. Épinglez son icône dans la barre d'outils (pièce de puzzle, puis punaise) pour voir le badge de capture.

Aucune étape de construction : pas de framework, pas de `npm install`. Le dossier se charge tel quel.

Après toute modification d'un fichier (par exemple `prompts/contexte-elliacare.md`), cliquez sur le bouton **Recharger** (flèche circulaire) de l'extension dans `chrome://extensions`.

## 2. Saisie de la clé API

1. Clic droit sur l'icône de l'extension, puis **Options** (ou bouton engrenage en haut du panneau).
2. Collez votre clé API Anthropic (elle commence par `sk-ant-`) dans le champ **Clé API**.
3. Cliquez sur **Enregistrer** : le champ se vide et la page indique "Une clé est enregistrée". La clé n'est plus jamais affichée.
4. Cliquez sur **Tester la clé** : un appel minimal est envoyé, la page affiche "OK" ou l'erreur rencontrée.

Où est stockée la clé : dans `chrome.storage.local`, sur cet ordinateur, pour ce profil Chrome uniquement. Elle n'est écrite ni dans le code, ni dans les journaux. Pour ne pas la stocker du tout dans le navigateur, utilisez le proxy (section 6).

### Modèle

- `claude-sonnet-5-5` : modèle par défaut.
- `claude-haiku-5-5` : plus rapide et moins cher.
- **Autre (saisie libre)** : n'importe quel autre nom de modèle.

Pour Sonnet 5.5 et Haiku 5.5, l'extension coupe la réflexion interne du modèle (elle compterait dans les jetons de réponse) : la réponse arrive plus vite et le JSON n'est pas tronqué. Avec Sonnet 5.5, un repli automatique côté serveur (`fallbacks: "default"`) est aussi activé : si le modèle décline une demande par excès de prudence, l'API la rejoue sur un autre modèle.

## 3. Raccourcis clavier et remappage

| Commande | Raccourci par défaut | Action |
|---|---|---|
| capture-post | `Alt+Shift+1` | Enregistre la sélection dans "Post" et ouvre le panneau |
| capture-commentaire | `Alt+Shift+2` | Enregistre la sélection dans "Commentaire" |
| capture-reponse | `Alt+Shift+3` | Enregistre la sélection dans "Réponse" |
| generer | `Alt+Shift+G` | Lance la génération avec les emplacements remplis et le contexte courant |

Sur Mac, `Alt` correspond à la touche `Option`.

Pour changer un raccourci :

1. Ouvrez `chrome://extensions/shortcuts` (ou bouton **Modifier les raccourcis** dans les options).
2. Repérez "Réponses LinkedIn", cliquez sur le crayon à côté de la commande, puis tapez la nouvelle combinaison.

Conflits possibles : selon le système, la disposition du clavier ou d'autres extensions, une combinaison peut être déjà prise. Chrome laisse alors le raccourci vide ("non défini" dans les options et dans le panneau). Il suffit d'en choisir un autre sur la page des raccourcis. Les raccourcis affichés dans le panneau suivent automatiquement vos changements.

## 4. Usage pas à pas

1. Sur LinkedIn, sélectionnez le texte d'un post, puis `Alt+Shift+1`. Le texte va dans l'emplacement **Post**, le panneau latéral s'ouvre, et le badge de l'icône affiche `P`.
2. Facultatif : sélectionnez un commentaire, puis `Alt+Shift+2` (badge `PC`).
3. Facultatif : sélectionnez la réponse d'un tiers à ce commentaire, puis `Alt+Shift+3` (badge `PCR`).
4. Dans le panneau, réglez (chaque choix est mémorisé) :
   - **Contexte** : Elliacare, OCD, IA ou Autre (avec une précision facultative, par exemple "juridique" ou "RH") ;
   - **Longueur** : Flash (une seule ligne très courte), Court (deux lignes maximum) ou Standard (trois lignes maximum, jamais au-delà). Dans tous les cas, des phrases courtes : 12 mots maximum par phrase (10 en Flash) ;
   - **Ironie** : 0 (aucune, ton direct et sincère), 1 (une touche d'humour sec ou d'autodérision), 2 (ironie assumée, piquante et complice) ;
   - **Humour** : ajoute une ligne drôle et percutante, en plus des quatre commentaires ;
   - **3 fautes** : passe de deux fautes volontaires (par défaut) à trois ;
   - **Lien Elliacare** : chaque commentaire fait alors un lien concret avec Elliacare.
5. Cliquez sur **Générer**, appuyez sur `Entrée` (ou `Ctrl+Entrée` depuis une zone de texte), ou utilisez `Alt+Shift+G`.
6. Les commentaires s'affichent : **Humour** (si coché), **Réflexion 1**, **Réflexion 2**, **Point non vu 1**, **Point non vu 2**. Sous chacun, la ligne grise "Fautes volontaires" liste les fautes glissées exprès : deux par commentaire (trois avec l'option), quelle que soit la longueur, ligne d'humour comprise. Une des fautes peut être deux mots collés ("parceque", "enfait", "dela"), seulement si la lecture reste immédiate. Cette ligne n'est jamais copiée, et elle indique "(attendu : N)" si le compte n'y est pas.
7. Cliquez sur l'icône de copie à droite du commentaire choisi : elle devient une coche pendant un instant. Collez dans LinkedIn et publiez vous-même.
8. **Régénérer** relance avec les mêmes entrées. Les ouvertures des commentaires sont tirées au sort à chaque génération (prise de position, aveu, antithèse sèche, question, retournement, image de terrain, chute, désaccord poli) : deux générations ne se ressemblent pas.

### Style et formules toutes faites

Les commentaires sont écrits à la première personne, dans la voix de Franck : prise de position, doute ou aveu assumés, "je" porteur dans au moins trois commentaires sur quatre. Les formules toutes faites sont interdites ("Ce qui me frappe", "Le plus frappant", "Ce que l'on oublie souvent", "Un point qu'on oublie souvent", "Ce qu'on ne dit pas", "Le vrai sujet", "bravo", "merci pour le partage", etc.).

Contrôle automatique : si un commentaire contient malgré tout une de ces formules, dépasse la longueur demandée, contient une phrase trop longue, ou si un élément manque, l'extension demande aussitôt une réécriture au modèle (une seule fois). Si un défaut subsiste, une alerte rouge "À relire" s'affiche sous le commentaire concerné.

Le mode est déduit des emplacements remplis et affiché en haut du panneau :

| Emplacements remplis | Mode |
|---|---|
| Post seul | commentaire sur un post |
| Post + Commentaire | réponse à un commentaire |
| Post + Commentaire + Réponse | réponse à une réponse |
| Commentaire seul | réponse à un commentaire, sans le post |
| Autre combinaison (par exemple Réponse sans Commentaire) | invalide : la génération est bloquée avec un message |

Les trois zones de texte restent modifiables à la main. Chaque zone a un bouton **vider**, et **Tout vider** remet le panneau à zéro. Les captures disparaissent à la fermeture du navigateur (`chrome.storage.session`).

Un bloc **Placement Elliacare (optionnel)** apparaît quand l'IA juge qu'une mention d'Elliacare serait pertinente alors que "Lien Elliacare" est éteint : c'est une phrase séparée, à ajouter ou non.

## 5. Personnaliser les prompts

- `prompts/system.md` : prompt système complet (identité, modes, style, interdits, format JSON de sortie).
- `prompts/contexte-elliacare.md` : complément ajouté au prompt système quand le contexte est Elliacare ou quand "Lien Elliacare" est actif. Il est pré-rempli avec les règles de langage du skill "elliacare-contexte" (langage interdit, expressions de référence, posture). Vous pouvez y coller la version complète de votre skill. Le bloc de commentaire HTML en tête est ignoré, et si le fichier ne contient rien d'autre, le complément est simplement omis.

Attention : le dépôt GitHub est public. Ne mettez rien de confidentiel dans ces fichiers sur GitHub : faites-le uniquement dans votre copie locale.

Après modification : bouton **Recharger** dans `chrome://extensions`.

## 6. Proxy (facultatif)

Si une **URL de proxy** est renseignée dans les options, l'extension envoie à cette URL, en POST, `{ system, messages, model, max_tokens }` (plus les réglages de réflexion du modèle) avec l'en-tête `Authorization: Bearer <jeton>`, au lieu d'appeler l'API Anthropic en direct. La clé API reste côté serveur.

Deux possibilités :

- **Fonction Vercel fournie** (`api/proxy.js` à la racine du dépôt) : dans le projet Vercel, ajoutez les variables d'environnement `ANTHROPIC_API_KEY` et `PROXY_TOKEN` (jeton aléatoire d'au moins 24 caractères), redéployez, puis renseignez `https://<votre-site>.vercel.app/api/proxy` et le jeton dans les options. Tant que ces variables ne sont pas définies, la fonction répond "proxy non configuré" et ne fait rien.
- **Webhook n8n** : tout point d'accès qui accepte ce format et renvoie la réponse de l'API Anthropic (ou directement le JSON des variantes) fonctionne.

À l'enregistrement de l'URL, Chrome demande l'autorisation d'accéder à ce domaine (permission optionnelle). **Désactiver le proxy** revient à l'appel direct.

## 7. Dépannage

| Symptôme | Cause probable et solution |
|---|---|
| Rien ne se passe au raccourci | Le raccourci n'est pas défini (conflit). Vérifiez `chrome://extensions/shortcuts`. Vérifiez aussi que l'extension est activée. |
| Badge `!` pendant 2 secondes | La sélection était vide : sélectionnez le texte d'abord. Ou la page est protégée (`chrome://`, Chrome Web Store, PDF intégrés) : aucune capture possible. Rien n'a été écrasé. |
| Le panneau ne s'ouvre pas au raccourci | Cliquez une fois sur l'icône de l'extension (le clic ouvre aussi le panneau). Le texte est quand même capturé : le badge le confirme. |
| "Aucune clé API enregistrée" | Saisissez la clé dans les options (section 2). |
| "Clé API refusée" | Clé erronée ou révoquée : ressaisissez-la, puis "Tester la clé". |
| "Limite de débit atteinte" | Trop de requêtes en peu de temps : patientez quelques secondes puis réessayez. |
| "Délai dépassé" | Pas de réponse en 30 secondes : réessayez. Si cela se répète, essayez `claude-haiku-5-5`. |
| "Modèle introuvable" | Le nom du modèle est mal saisi dans les options. |
| "Combinaison invalide" | Une Réponse a besoin du Commentaire auquel elle répond. Capturez-le ou videz la Réponse. |
| "Réponse hors format : texte brut affiché" | Le modèle n'a pas renvoyé le JSON attendu, même après une relance. Le texte brut reste copiable. Cliquez sur "Régénérer". |
| "Copie impossible" | Le presse-papiers a refusé l'écriture. Le texte est alors sélectionné automatiquement : `Ctrl+C` (`Cmd+C` sur Mac). |
| Le contexte Elliacare semble ignoré | Vérifiez `prompts/contexte-elliacare.md`, puis rechargez l'extension. |

Pour voir les erreurs techniques : `chrome://extensions`, puis lien **Service worker** (journal du service worker) ou clic droit dans le panneau, **Inspecter**. Aucune clé n'apparaît dans ces journaux.

## 8. Sécurité et vie privée

- Permissions : `activeTab`, `scripting`, `storage`, `sidePanel`, `clipboardWrite`. Permission d'hôte : `https://api.anthropic.com/*` uniquement, plus le domaine du proxy s'il est configuré (permission optionnelle). Aucune permission sur linkedin.com : l'accès à la page n'est accordé par Chrome qu'au moment du raccourci (`activeTab`).
- Aucune télémétrie, aucun suivi. Le seul appel réseau part vers le point d'accès IA configuré.
- Le texte envoyé à l'IA se limite aux trois emplacements et au contexte choisi.
- Contrôle de sécurité avant affichage : tout tiret long est remplacé par une virgule et tout point-virgule (hors smiley `;-)`) par un point. Les formules toutes faites déclenchent une réécriture automatique, puis une alerte si elles persistent.

## 9. Fichiers

```text
extension-reponses-linkedin/
  manifest.json          déclaration Manifest V3, raccourcis, permissions
  background.js          commandes, capture de la sélection, badge, ouverture du panneau
  sidepanel.html/.css/.js  panneau latéral : emplacements, contexte, génération, rendu, copie
  ia.js                  fonctions partagées : mode, gabarit, attaques, appel IA, erreurs, JSON, nettoyage, contrôle des formules
  options.html/.js       clé API, modèle, proxy, rappel des raccourcis
  prompts/system.md      prompt système
  prompts/contexte-elliacare.md  complément Elliacare
  icons/                 icônes 16, 32, 48, 128 px
```
