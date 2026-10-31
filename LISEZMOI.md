# Comptes Taiwan – application web (Android + PC)

Application installable (PWA) qui lit votre classeur `Comptes_Taiwan_V2.xlsx` dans Google Drive, affiche les analyses, permet d'ajouter / modifier des lignes et réécrit le fichier **sans casser les formules Excel 365** (XLOOKUP, ANCHORARRAY, LET/UNIQUE/FILTER), ni les graphiques, tableaux et validations.

## Comment ça marche

- **Lecture** : l'application ouvre le .xlsx dans le navigateur et refait elle-même les calculs du classeur : catégorisation (Forcé > mots-clés > objets appris > Vie Quotidienne), soldes, contrôles N12/N17, onglets annuels, Analysis, patrimoine. Ces calculs ont été vérifiés contre les valeurs du fichier : les 2 429 catégories et tous les totaux sont identiques.
- **Écriture** : seules les cellules de saisie sont modifiées, directement dans le XML du fichier (Date, Compte, Objet, Forcé, Crédit, Débit ; mouvements d'investissement ; valeurs actuelles ; Compte FR ; taux). Les nouvelles lignes remplissent d'abord les lignes vides en haut du tableau (lignes 6 à 14). Quand elles sont toutes prises, la ligne est ajoutée en bas du tableau `Transactions`, avec ses formules. Le fichier est marqué « recalcul complet à l'ouverture » : Excel recalcule tout à la prochaine ouverture.
- **Enregistrement sur Drive** : l'application relit d'abord la dernière version sur Drive, y applique vos modifications, puis remplace le fichier. Si une ligne a été modifiée entre-temps dans Excel, la modification correspondante est refusée et vous êtes prévenu ; rien n'est écrasé à l'aveugle. Une fois par jour, la version précédente est marquée « conserver indéfiniment » dans l'historique des versions Drive.
- **Hors connexion** : l'application et une copie du classeur restent sur l'appareil. Vous pouvez consulter et saisir sans réseau, puis enregistrer plus tard.

## Mise en place (environ 20 minutes, une seule fois)

### 1. Héberger l'application (GitHub Pages, gratuit)
1. Créez un compte sur github.com, puis un dépôt `comptes-taiwan` (Public : le code ne contient aucune donnée).
2. « Add file → Upload files » : déposez **le contenu** de ce dossier (index.html, css/, js/, vendor/, icons/, sw.js, manifest.webmanifest, .nojekyll).
3. Settings → Pages → Source : « Deploy from a branch », branche `main`, dossier `/ (root)`.
4. Votre adresse sera `https://VOTRE-PSEUDO.github.io/comptes-taiwan/`.

### 2. Autoriser l'accès Google Drive (Google Cloud Console)
1. Ouvrez console.cloud.google.com, puis créez un projet « Comptes Taiwan ».
2. « API et services → Bibliothèque » : activez **Google Drive API** et **Google Picker API**.
3. « Google Auth Platform » (écran de consentement OAuth) :
   - Type **Externe**, nom « Comptes Taiwan », votre e-mail.
   - Audience : laissez en mode **Test** et ajoutez **husson.seb@gmail.com** comme utilisateur test. *Personne d'autre ne pourra se connecter.*
   - Accès aux données : ajoutez le champ d'application `.../auth/drive.file`. L'application ne voit alors que les fichiers que vous choisissez vous-même.
4. Clients → Créer un client → **Application Web** → Origines JavaScript autorisées : `https://VOTRE-PSEUDO.github.io` (sans le chemin). Copiez l'**ID client**.
5. Identifiants → Créer une **clé API** → restreignez-la : référents HTTP `https://VOTRE-PSEUDO.github.io/*` et API « Google Picker API » uniquement.
6. Notez le **numéro du projet** (page d'accueil du projet, en chiffres).

### 3. Renseigner `js/config.js`
Remplacez `CLIENT_ID`, `API_KEY` et `APP_ID` (numéro du projet), puis renvoyez le fichier sur GitHub. Ces identifiants ne sont pas secrets.

### 4. Utiliser
- **PC** : ouvrez l'adresse, cliquez sur « Se connecter à Google Drive », puis choisissez `Comptes_Taiwan_V2.xlsx`. Google affichera peut-être « application non validée » : c'est normal pour une application personnelle, cliquez sur « Continuer ».
- **Android** : ouvrez l'adresse dans Chrome, puis menu ⋮ → **Installer l'application** (ou « Ajouter à l'écran d'accueil »).

## Utilisation au quotidien
- Bouton **+** : nouvelle ligne. La catégorie automatique s'affiche en direct ; « Forcer » remplit la colonne Force, et l'objet sera appris.
- Ligne sans date : cochez « en attente ». Pour la passer en débitée, ouvrez-la, décochez, puis validez.
- Le compteur **« N modif. »** en haut liste ce qui n'est pas encore enregistré. Bouton « Enregistrer sur Drive ».
- **Patrimoine** : saisissez la valeur actuelle des plateformes, le Compte FR, le taux de change, ou ajoutez un mouvement d'investissement.

## Règle importante quand vous travaillez aussi dans Excel
L'application suit le fichier par son **identifiant Drive**. Pour enregistrer depuis Excel, gardez le même fichier :
- soit avec Google Drive pour ordinateur (le fichier synchronisé est mis à jour sur place),
- soit dans Drive web, clic droit sur le fichier → **Gérer les versions → Importer une nouvelle version**.
Si vous importez un *nouveau* fichier à la place, rechoisissez-le dans l'application (menu ⋮).

## Limites connues
- Tant qu'Excel n'a pas rouvert le fichier, les cellules de synthèse (onglets annuels, Analysis…) gardent leurs anciennes valeurs dans le fichier, par exemple dans l'aperçu Drive. L'application, elle, affiche toujours les bons chiffres. Les valeurs de la ligne ajoutée (catégorie, statut, net, année, mois) sont en revanche écrites immédiatement.
- Les mouvements d'investissement déjà saisis et les règles (onglet Rules) se modifient dans Excel.
- Les lignes ajoutées en bas du tableau (une fois les 9 lignes vides du haut utilisées) restent correctes pour toutes les formules, mais ne sont pas dans l'ordre chronologique. Pour retrouver des lignes vides en haut, insérez-en dans Excel comme d'habitude (Ctrl+Maj++).

## Sécurité
- Aucun serveur : le code tourne dans votre navigateur. Les données ne transitent qu'entre votre appareil et votre Google Drive.
- Connexion limitée à votre compte Google (mode test) ; accès limité au fichier choisi (`drive.file`).
- Politique de sécurité du contenu stricte : scripts locaux et Google uniquement, aucune bibliothèque chargée depuis un CDN tiers.
- Menu ⋮ → « Se déconnecter et effacer les données de cet appareil » : révoque l'accès Google et supprime la copie locale. Vous pouvez aussi désactiver la copie hors-ligne.
- Pensez au verrouillage de l'écran de votre téléphone : la copie hors-ligne est lisible par quiconque a accès à l'appareil déverrouillé.

## Mettre à jour l'application
Après une modification du code, changez `VERSION` dans `sw.js` (par exemple `ct-v2`) pour que les appareils rechargent la nouvelle version.
