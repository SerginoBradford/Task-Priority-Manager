# Mes priorités

Ton outil de gestion de tâches et de notes :

- **Ma journée** : la semaine en haut avec tes dates de rendu, et pour chaque jour la liste de ce qu'il faut faire, classée selon la **priorité** et la **proximité de la date de rendu**. Les 3 plus importantes sont mises en avant (« À faire en premier ») ; les tâches peu prioritaires à rendu lointain sont rangées dans « Plus tard ».
- La date d'une tâche est sa **date de rendu** (échéance), pas le jour où tu la fais : une tâche « Critique » à rendre dans 2 jours passera avant une tâche « Haute » à rendre dans 3 semaines.
- **Vue d'ensemble** : toutes tes tâches regroupées par priorité (Critique, Haute, Moyenne, Basse), avec recherche et filtre À faire / Terminées.
- **Notes** : des notes libres, avec recherche et épinglage. Chaque tâche peut aussi avoir sa propre note.
- Installable sur ton téléphone comme une vraie appli, et consultable hors connexion.

Coût : **0 €** (GitHub Pages ou Vercel + offre gratuite de Supabase).

---

## Étape 0 — Essayer tout de suite (facultatif)

Tu peux mettre l'appli en ligne sans rien configurer (étape 2). Elle fonctionne alors en **mode local** : tes données restent dans le navigateur de l'appareil utilisé. Des tâches d'exemple s'affichent pour te montrer le fonctionnement ; un bouton permet de les effacer.

Pour retrouver tes tâches sur **tous tes appareils**, fais l'étape 1.

## Étape 1 — Créer la base de données (Supabase)

1. Va sur [supabase.com](https://supabase.com), crée un compte gratuit, puis **New project**. Choisis un nom (ex. `mes-priorites`), un mot de passe de base de données (garde-le de côté) et la région la plus proche (ex. Europe).
2. Une fois le projet prêt, ouvre **SQL Editor** > **New query**, colle tout le contenu du fichier `supabase-schema.sql`, puis clique sur **Run**. Tu dois voir « Success ».
3. Ouvre **Project Settings** > **API** (ou le bouton **Connect** en haut). Copie :
   - l'**URL du projet** (`https://xxxxx.supabase.co`)
   - la clé **anon** ou **publishable** (⚠️ jamais la clé `service_role` / `secret`)
4. Ouvre le fichier `config.js` et colle ces deux valeurs entre les guillemets :
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: "https://xxxxx.supabase.co",
     SUPABASE_ANON_KEY: "ta-cle-anon-ou-publishable"
   };
   ```

> La clé anon/publishable est faite pour être publique : la sécurité vient des règles créées par le script SQL, qui empêchent quiconque de voir les données d'un autre compte.

## Étape 2 — Mettre en ligne

### Option A : GitHub Pages

1. Sur [github.com](https://github.com), clique sur **New repository**, nomme-le `mes-priorites`, laisse-le **Public** et crée-le.
2. Sur la page du dépôt : **Add file** > **Upload files**. Glisse **tout le contenu** du dossier (les fichiers *et* les dossiers `icons` et `vendor`), puis **Commit changes**.
3. Va dans **Settings** > **Pages**. Sous *Build and deployment*, choisis **Deploy from a branch**, branche **main**, dossier **/ (root)**, puis **Save**.
4. Après une minute, ton appli est en ligne à l'adresse : `https://TON-PSEUDO.github.io/mes-priorites/`

> GitHub Pages gratuit nécessite un dépôt public : le code est visible, mais **pas tes données** (elles sont dans Supabase, protégées par ton compte). Évite simplement de mettre autre chose que les clés anon/publishable dans `config.js`.

### Option B : Vercel

1. Mets d'abord les fichiers sur GitHub (étapes A1 et A2 ; ici le dépôt peut être privé).
2. Sur [vercel.com](https://vercel.com), connecte-toi avec GitHub, **Add New** > **Project**, importe le dépôt `mes-priorites`.
3. Laisse *Framework Preset* sur **Other**, aucune commande de build, puis **Deploy**. Ton adresse ressemble à `https://mes-priorites.vercel.app`.

## Étape 3 — Relier Supabase à ton adresse

Dans Supabase : **Authentication** > **URL Configuration**. Mets ton adresse (GitHub Pages ou Vercel) dans **Site URL** et dans **Redirect URLs**, puis enregistre. C'est ce qui permet au lien de confirmation reçu par e-mail de te ramener sur ton appli.

Ouvre ensuite ton appli, clique sur **Créer un compte**, confirme ton e-mail, puis connecte-toi.

**Conseil sécurité** : une fois ton compte créé, va dans **Authentication** > **Sign In / Providers** (ou *Settings*) et désactive **Allow new users to sign up**. Ainsi, personne d'autre ne pourra créer de compte sur ton outil.

## Étape 4 — Installer sur ton téléphone

- **Android (Chrome)** : ouvre ton adresse, menu ⋮ > **Installer l'application** (ou *Ajouter à l'écran d'accueil*).
- **iPhone (Safari)** : ouvre ton adresse, bouton **Partager** > **Sur l'écran d'accueil**.

L'appli s'ouvre alors en plein écran, comme une appli normale. Sans connexion, tu peux consulter et modifier tes tâches : les changements sont envoyés dès que la connexion revient (l'indicateur en haut affiche « Hors ligne · en attente »).

---

## Bon à savoir

- **Sauvegarde** : menu ⋯ > *Exporter mes données* télécharge toutes tes tâches et notes dans un fichier.
- **Mettre à jour l'appli** : remplace les fichiers sur GitHub, et change `VERSION` dans `sw.js` (ex. `'v2'`) pour que les téléphones récupèrent la nouvelle version.
- **Supabase gratuit** met un projet en pause après environ une semaine sans aucune activité. Si tu utilises l'outil régulièrement, ça n'arrive pas ; sinon il suffit de le réactiver depuis le tableau de bord Supabase (tes données sont conservées).
- **Rappels / notifications** : pas encore inclus. C'est une évolution possible dans un second temps.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html` | La page de l'appli |
| `styles.css` | L'apparence (thème clair et sombre automatique) |
| `app.js` | Le fonctionnement (tâches, priorités, notes, synchronisation) |
| `config.js` | **À remplir** avec tes clés Supabase |
| `supabase-schema.sql` | À exécuter une fois dans Supabase |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installation sur téléphone et mode hors ligne |
| `vendor/` | Bibliothèque Supabase (incluse pour fonctionner hors ligne) |
