# Budget Perso

Application de gestion de budget personnel — 100% gratuite (dans les limites des
paliers gratuits utilisés), qui fonctionne sur n'importe quel PC ou téléphone via
une simple URL, avec synchronisation automatique via **ton propre** Google Drive.
Aucun abonnement, aucun serveur à maintenir.

## Comment ça marche

- Tes données (revenus, charges, échéances) sont d'abord stockées localement
  (`localStorage`) pour un affichage instantané, sans écran blanc.
- Si Google Drive est connecté, l'app réconcilie automatiquement en arrière-plan
  à chaque ouverture (et à chaque modification) : ouvre l'URL sur ton PC du
  travail, elle affiche les mêmes chiffres que sur ton PC perso, sans rien
  cliquer. Un dossier privé « Budget Perso » est créé sur ton Drive.
- Une sauvegarde manuelle (export/import d'un fichier `.json`) reste toujours
  disponible, sans avoir besoin de Google Drive.
- **Import de document par IA** : un bouton « Importer un document (IA) »
  permet d'envoyer une photo/PDF (fiche de paye, avis d'imposition…) — l'IA
  (Google Gemini, palier gratuit) en extrait les montants et pré-remplit le
  formulaire correspondant. Rien n'est jamais enregistré sans que tu cliques
  toi-même sur « Enregistrer ». Voir la section dédiée plus bas.

## 1. Lancer en local

```bash
npm install
npm run dev
```

Ouvre l'URL affichée (en général `http://localhost:5173`).

À ce stade, tout fonctionne déjà **sans rien configurer** — sauf le bouton
« Se connecter à Google Drive », qui a besoin d'un Client ID Google (étape 2).

## 2. Configurer Google Drive (une seule fois, optionnel)

Cette étape n'est nécessaire que si tu veux la synchronisation automatique entre
appareils. Sans elle, l'app fonctionne très bien avec juste l'export/import manuel.

1. Va sur [console.cloud.google.com](https://console.cloud.google.com/)
2. Crée un nouveau projet, par exemple **« Budget Perso »**
3. Dans la barre de recherche, cherche **« Google Drive API »** → clique **Enable**
4. Va dans **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Type d'application : **Web application**
   - Authorized JavaScript origins : `http://localhost:5173`
   - (l'URL Vercel sera ajoutée à l'étape 4, une fois déployé)
5. Copie ton **Client ID** (ressemble à `123456-abc.apps.googleusercontent.com`)
6. Copie `.env.example` en `.env` à la racine du projet, et colle ton Client ID :
   ```
   VITE_GOOGLE_CLIENT_ID=123456-abc.apps.googleusercontent.com
   ```
7. Relance `npm run dev`, ouvre l'onglet **Sauvegarde**, clique
   « Se connecter à Google Drive »

> Note : tant que l'app Google Cloud est en mode "Test" (par défaut), seuls les
> comptes Google que tu ajoutes explicitement dans **OAuth consent screen → Test users**
> peuvent se connecter — ajoute ta propre adresse Gmail. C'est normal et suffisant
> pour un usage personnel : pas besoin de publier l'app.

## 3. Configurer l'import de document par IA (une seule fois, optionnel)

Cette étape n'est nécessaire que si tu veux utiliser le bouton
« Importer un document (IA) ». Sans elle, tout le reste de l'app fonctionne
normalement, en saisie manuelle.

1. Va sur [aistudio.google.com](https://aistudio.google.com), connecte-toi avec
   ton compte Google.
2. Dans la barre latérale, clique sur l'icône en forme de clé → **Create API key**
   (aucune carte bancaire requise pour le palier gratuit).
3. Copie la clé (elle commence par `AIza…`).
4. **Ne la mets pas dans `.env`** pour un usage normal : elle doit rester
   strictement côté serveur. Ajoute-la directement dans Vercel une fois le
   projet déployé (étape 4 ci-dessous) → **Settings → Environment Variables**
   → nom `GEMINI_API_KEY`, valeur = ta clé.
5. Si tu veux tester cette fonctionnalité en local avant de déployer, installe
   la CLI Vercel (`npm i -g vercel`) et lance `vercel dev` à la place de
   `npm run dev` — c'est la seule commande qui simule aussi les fonctions
   serverless (`api/parse-document.js`) localement. Avec `npm run dev` seul,
   tout le reste de l'app fonctionne, mais ce bouton précis renverra une erreur.

> Le modèle utilisé est `gemini-2.5-flash` (défini dans
> `api/parse-document.js`). Si Google retire ce modèle un jour, remplace son
> nom par celui affiché dans ta console AI Studio.

## 4. Déployer en ligne, gratuitement (Vercel)

Pour y accéder depuis ton téléphone avec une vraie URL :

1. Crée un dépôt GitHub, par exemple `budget-perso`, et pousse ce code dedans :
   ```bash
   git init
   git add .
   git commit -m "Budget perso"
   git branch -M main
   git remote add origin https://github.com/TON_PSEUDO/budget-perso.git
   git push -u origin main
   ```
2. Va sur [vercel.com](https://vercel.com/) → **Sign up** avec GitHub
3. **Add New → Project**, choisis le dépôt `budget-perso` → **Deploy**
   (Vercel détecte Vite automatiquement, rien à configurer)
4. Dans les paramètres du projet Vercel → **Environment Variables**, ajoute :
   - `VITE_GOOGLE_CLIENT_ID` = ton Client ID (celui de l'étape 2)
   - `GEMINI_API_KEY` = ta clé Gemini (celle de l'étape 3, si tu veux l'import IA)
   puis redéploie (**Deployments → ⋯ → Redeploy**)
5. Retourne dans Google Cloud Console → ton OAuth Client ID → ajoute :
   - Authorized JavaScript origins : `https://budget-perso-xxxx.vercel.app`
     (l'URL exacte que Vercel t'a donnée)
6. C'est prêt : ouvre l'URL Vercel sur ton PC du travail comme sur ton PC perso ou
   ton téléphone — connecte ton Google Drive une fois, et les deux se
   synchronisent automatiquement à chaque ouverture.

## Confidentialité

- Le budget lui-même (revenus, charges, échéances) ne transite que par ton propre
  compte Google Drive (scope `drive.file` : l'app ne voit que les fichiers qu'elle
  a elle-même créés dans le dossier « Budget Perso », jamais le reste de ton Drive).
- La seule fonction serveur du projet (`api/parse-document.js`) sert uniquement à
  cacher ta clé Gemini — elle ne stocke rien, elle relaie juste la requête vers
  l'API Google Gemini le temps d'un import de document, puis oublie tout.
- Un document envoyé via « Importer un document (IA) » est donc transmis à Gemini
  au moment de l'analyse (palier gratuit : Google peut utiliser ces échanges pour
  améliorer ses modèles — voir les conditions de Google AI Studio si ça te gêne,
  une clé payante désactive cet usage). Rien n'est envoyé si tu n'utilises pas
  ce bouton.
- Tu peux te déconnecter de Google Drive à tout moment depuis l'onglet Sauvegarde ;
  tes données restent sur l'appareil.

## Limites connues (V1)

- Résolution de conflit volontairement simple (adaptée à un usage solo) : si tu
  modifies le budget sur deux appareils sans connexion internet entre les deux,
  c'est la modification la plus récente (horodatage `updatedAt`) qui l'emporte
  à la prochaine synchronisation — pas de fusion champ par champ.
- La réconciliation automatique Drive au chargement dépend d'un jeton Google
  obtenu silencieusement ; si ton navigateur bloque les cookies tiers ou si la
  session a expiré, elle échoue silencieusement et l'app affiche tes dernières
  données locales avec une pastille « Drive à reconnecter » — un clic sur
  « Se connecter à Google Drive » dans Paramètres suffit à relancer la synchro.
- Pas de notifications push/email automatiques (nécessiterait un petit service
  serveur en plus) — les échéances proches restent visibles et mises en évidence
  dans l'app à chaque ouverture.
- L'import IA est aussi bon que la lisibilité du document et le palier gratuit
  Gemini : relis toujours les champs pré-remplis avant d'enregistrer.
"# budget-perso" 
"# budget-perso" 
