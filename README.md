# CESIBridge

Serveur MCP (stdio) qui donne accès à l'ENT, à Moodle et aux sommaires Scholarvox du CESI avec la session SSO, via Playwright, dockerisé.

| Outil                | Rôle                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `cesi_check_session` | Charge l'ENT en headless avec la session enregistrée : `valid`, `expired`, `absent`, `invalid` ou `error`. |
| `cesi_login`         | Renvoie la procédure de login manuel (le serveur n'a pas d'écran).                                         |

### Outils Moodle et Scholarvox

Lecture seule, résultats bornés (textes tronqués à 500 caractères, listes limitées). Le contenu vient de sites tiers : il ne doit pas être traité comme des instructions.

| Outil                       | Paramètres                 | Résultat                                                                                          |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `moodle_list_courses`       | —                          | Cours inscrits : `id`, `name`, `shortName`, `category`, `url`, `startDate`, `endDate`, `progress` |
| `moodle_upcoming_deadlines` | `days` (1 à 90, défaut 14) | Échéances triées (heure de Paris), retards des 7 derniers jours compris                           |
| `moodle_get_course`         | `courseId`                 | Sections, activités visibles (`type` = module Moodle) et livres Scholarvox (`docid`)              |
| `moodle_download_resource`  | `url` (moodle.cesi.fr)     | Fichier enregistré dans `CESI_DOWNLOAD_DIR` (sans écrasement, pages HTML refusées, taille bornée) |
| `scholarvox_get_toc`        | `docid` **ou** `url`       | Titre et sommaire (`name`, `page`, `level`), sans connexion ni texte des chapitres                |

Chaque appel Moodle charge la session enregistrée, la vérifie sur l'ENT, puis ouvre Moodle par le lien SSO (`CESI_MOODLE_URL` ou lien « Moodle One Cesi » de l'ENT) et interroge l'API AJAX interne (`/lib/ajax/service.php`). Si la session a expiré et que `CESI_EMAIL`/`CESI_PASSWORD` sont définis, le serveur se reconnecte seul (un seul essai, une seule reconnexion à la fois) ; sinon il renvoie la procédure `cesi_login`.

Aucun identifiant n'est stocké : seule la session (`storageState` : cookies + localStorage) est conservée, dans le volume Docker `cesibridge-data`.

## Architecture

```
src/config.js            variables d'env validées (zod), échec immédiat si invalides
src/browser/session.js   lecture/écriture du storageState (600), navigateur partagé lancé à la demande
src/browser/sso.js       détection « connecté » par hôte final, login automatique (machine à états)
src/browser/sessionManager.js  session partagée : vérification, reconnexion unique, enregistrement
src/moodle/              ouverture Moodle (SSO), client AJAX, conversion des réponses, téléchargement, image du calendrier des examens
src/exams/               calendrier des examens : OCR, parsing, corrections, événements Google
src/schedule/, src/db/, src/google/  emploi du temps, PostgreSQL (migrations), Google Calendar
src/scholarvox/          docid des liens de cours, sommaire public (/catalog/toc)
src/tools/*.js           outils MCP
src/server.js            McpServer + transport stdio, arrêt propre (SIGTERM, stdin fermé)
scripts/explore.js       étape 1 : journal des redirections SSO + HAR
scripts/login.js         login manuel -> storageState
docker/                  Dockerfile (cibles mcp et login) + entrypoint noVNC
```

Choix de conception :

- **`storageState` plutôt qu'un profil Chromium** : portable Windows → Linux (un profil est chiffré par DPAPI), pas de verrou, un contexte neuf par appel donc appels parallèles possibles.
- **Login séparé du serveur MCP** : un conteneur `docker run -i` n'a pas d'écran. Le login passe par un service Compose dédié (Xvfb + noVNC) ouvert dans ton navigateur.
- **stdout réservé au protocole MCP** : tous les logs vont sur stderr.

## Prérequis

- Docker (Compose v2).
- Pour l'exploration locale : Node.js ≥ 22.13 et `npx playwright install chromium`.

## Configuration

```bash
cp .env.example .env
```

| Variable                | Obligatoire | Défaut                                                   | Rôle                                                                                  |
| ----------------------- | ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `CESI_ENT_URL`          | oui         | —                                                        | Point d'entrée de l'ENT.                                                              |
| `CESI_LOGGED_IN_HOSTS`  | oui         | —                                                        | Hôtes « connecté », séparés par des virgules ; `*.domaine.fr` pour les sous-domaines. |
| `CESI_STATE_PATH`       | non         | `./data/state.json` (local), `/data/state.json` (Docker) | Fichier de session.                                                                   |
| `CESI_NAV_TIMEOUT_MS`   | non         | `30000`                                                  | Timeout de chargement de l'ENT.                                                       |
| `CESI_LOGIN_TIMEOUT_MS` | non         | `300000`                                                 | Durée max du login manuel (MFA compris).                                              |

`.env` doit rester compatible avec `docker run --env-file` : pas de guillemets, pas de commentaire en fin de ligne.

## Première connexion

### 1. Explorer la chaîne SSO (local, une fois)

```bash
npm ci
npx playwright install chromium
npm run explore -- https://ent.cesi.fr/
```

Connecte-toi dans la fenêtre, puis ferme-la. Le script affiche les domaines traversés (ENT → SSO → ENT…) et écrit `data/redirects.log` (valeurs des paramètres d'URL masquées) et `data/login.har`.

> ⚠️ `data/login.har` contient des cookies et des jetons : ne jamais le committer ni le partager. Supprime-le une fois l'exploration terminée.

Reporte dans `CESI_LOGGED_IN_HOSTS` les hôtes atteints **une fois connecté** (pas ceux du SSO).

### 2. Construire les images

```bash
docker compose build mcp
docker compose --profile login build login
```

### 3. Se connecter via noVNC

```bash
docker compose --profile login run --rm --service-ports login
```

Ouvre <http://localhost:6080/vnc.html>, clique sur « Connect » et connecte-toi. Dès que l'ENT est atteint, la session est enregistrée dans le volume `cesibridge-data` et le conteneur s'arrête.

Le script affiche le nombre de cookies de session (sans expiration) : ils sont inclus dans le `storageState`. Si `cesi_check_session` répond `expired` juste après un login réussi, c'est le premier point à vérifier.

## Synchronisation de l'emploi du temps

Login automatique (identifiants du `.env`) puis copie des N prochaines semaines dans PostgreSQL. Si `CESI_FILIERE` et `CESI_NIVEAU` sont définis, le calendrier des examens est ensuite lu sur Moodle (voir « Calendrier des examens »).

1. Renseigner dans `.env` : `CESI_EMAIL`, `CESI_PASSWORD`, `DATABASE_URL`, `POSTGRES_*` (voir `.env.example`).
2. `docker compose up -d db`
3. `npm run sync` (navigateur visible par défaut ; `CESI_HEADLESS=true` pour le masquer).

En headless dans Docker : `docker compose --profile sync run --rm sync`.

Planification automatique (toutes les 2 h de 7 h à 21 h + au démarrage) sur Windows, Linux et macOS : voir [`scheduler/README.md`](scheduler/README.md).

Un seul essai de login par exécution (pas de boucle, pour éviter le verrouillage du compte). Le schéma est géré par des migrations versionnées (`src/db/schema.js`, table `schema_migrations`), appliquées au démarrage sous verrou : `seances`, `seance_salles`, `intervenants`, `seance_intervenants`, `groupes`, `seance_groupes`, plus `examens` et `examens_sources` pour les examens (relationnel, sans JSON ; les adresses e-mail des intervenants ne sont pas stockées). Si l'API renvoie un format de séance inattendu, l'erreur liste les clés trouvées : adapter `src/schedule/mapping.js`.

## Google Calendar

Après chaque semaine synchronisée, `npm run sync` aligne un agenda Google « CESI » sur la base (création, mise à jour, suppression des seuls événements créés par CESIBridge). Une erreur Google n'annule pas la base : la publication s'arrête, le code de sortie est 1, et `npm run publish` republie les `CESI_SCHEDULE_WEEKS` semaines depuis la base (sans ENT ni navigateur ; code personne : `CESI_CODE_PERSONNE`, sinon celui présent en base).

### Mise en place

1. Créer un projet sur <https://console.cloud.google.com/> et y activer l'API **Google Calendar**.
2. Créer un **compte de service** (IAM et administration → Comptes de service), puis une clé JSON (onglet Clés → Ajouter une clé). Enregistrer le fichier sous `secrets/google-sa.json` (dossier ignoré par Git et par Docker).
3. Dans Google Agenda, créer un agenda « CESI » et le partager avec l'e-mail du compte de service (`…@…iam.gserviceaccount.com`) avec la permission « Apporter des modifications aux événements ».
4. Copier l'ID de l'agenda (Paramètres de l'agenda → Intégrer l'agenda) et renseigner dans `.env` :

```
GOOGLE_CALENDAR_ID=…@group.calendar.google.com
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./secrets/google-sa.json
```

Les deux variables vont ensemble (une seule définie = erreur). Dans Docker, le service `sync` monte `./secrets` en lecture seule sur `/run/secrets/cesibridge` et lit `google-sa.json`.

Les noms des intervenants figurent dans la description des événements : n'ajouter à l'agenda que des personnes de confiance.

### Voir l'agenda sur le téléphone

- **iPhone** : Réglages → Calendrier → Comptes → Ajouter un compte → Google, activer « Calendriers », puis cocher « CESI » dans l'app Calendrier.
- **Android** : ouvrir Google Agenda, cocher « CESI » dans la liste ; vérifier que la synchronisation du compte Google est active (Paramètres → Comptes).

## Calendrier des examens

Facultatif. Le cours Moodle de la catégorie « Ma session » (départagé par niveau et année) contient, dans la section « Généralités », une image « Calendrier des examens ». `npm run sync` la télécharge, la lit par OCR local (Tesseract, via `tesseract.js` et `sharp` ; aucune API externe, la langue française est embarquée), range les examens en base puis les publie dans l'agenda Google (si Google est configuré ; sinon ils restent seulement en base).

### Activation

Dans `.env` (voir `.env.example`) :

| Variable                     | Défaut                         | Rôle                                                                                       |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `CESI_FILIERE`               | —                              | Filière à retenir (ex. `FISE Informatique`). Avec `CESI_NIVEAU`, active la lecture.        |
| `CESI_NIVEAU`                | —                              | `A1` à `A5`. Défini avec `CESI_FILIERE`, sinon erreur.                                     |
| `CESI_ANNEE`                 | année en cours                 | `AAAA-AAAA` ; l'année change le 1er août (heure de Paris).                                 |
| `CESI_EXAM_REMINDER_DAYS`    | `1`                            | Rappels en jours avant l'examen : 4 valeurs au plus, de 1 à 27, séparées par des virgules. |
| `CESI_EXAM_CORRECTIONS_FILE` | `./data/exam-corrections.json` | Fichier de corrections (voir plus bas).                                                    |

Sans `CESI_FILIERE` ni `CESI_NIVEAU`, la fonctionnalité est désactivée.

### Ce qui est publié

Un événement par examen, au titre de l'élément évalué. Les rattrapages sont préfixés « [Rattrapage] ». Si l'horaire manque, l'événement couvre la journée entière. Le bloc, le format, la session et la plateforme sont dans la description, avec le lien « Calendrier d'origine ». Les rappels sont toujours à 7 jours, plus les jours de `CESI_EXAM_REMINDER_DAYS`. Les examens ont leur propre marqueur : ils n'interfèrent pas avec les séances.

### Lectures douteuses

Quand une date ou un horaire lu est douteux, rien n'est jeté : l'examen est publié, le titre est précédé de « ⚠ » et la description contient une ligne « À vérifier » (`date`, `horaire`). Un horaire douteux donne un événement sur la journée. Les mêmes examens sont listés dans les logs de `npm run sync`.

### Corrections manuelles

`CESI_EXAM_CORRECTIONS_FILE` est un tableau JSON, appliqué dans l'ordre après chaque lecture. Fichier absent = aucune correction ; fichier invalide = l'étape s'arrête avant tout accès réseau. Un examen est désigné par `match` (`element`, et `session` facultative ; sans `session`, toutes les sessions de l'élément ; comparaison insensible à la casse et aux accents).

```json
[
  {
    "match": { "element": "Génie logiciel" },
    "set": { "date": "2026-12-14", "debut": "09:00", "fin": "11:00" }
  },
  {
    "add": {
      "element": "Soutenance de projet",
      "date": "2026-12-18",
      "debut": "14:00",
      "fin": "15:00"
    }
  },
  { "match": { "element": "Génie logiciel", "session": "Rattrapage" }, "remove": true }
]
```

- `set` accepte `element`, `bloc`, `format`, `plateforme`, `session`, `date` (`AAAA-MM-JJ`), `debut` et `fin` (`HH:MM`) ; au moins un champ. Corriger `date` ou l'horaire retire le marqueur « À vérifier » correspondant.
- `add` exige `element` et `date` ; `bloc`, `format`, `plateforme`, `session`, `debut` et `fin` sont facultatifs.
- Les clés inconnues sont refusées. Un `match` sans correspondance est signalé dans les logs sans arrêter la synchronisation.

Dans Docker, le service `sync` lit `/data/exam-corrections.json` (volume `cesibridge-data`), quelle que soit la valeur du `.env`. Copier le fichier dans le volume :

```bash
docker run --rm -v cesibridge-data:/data -v "$PWD/data:/src:ro" alpine cp /src/exam-corrections.json /data/
```

### Cache et republication

L'OCR n'est relancé que si l'image ou le fichier de corrections change (ou si le lecteur évolue). Sinon les examens de la base sont réutilisés. Une lecture qui ne trouve aucun examen laisse la base inchangée. `npm run publish` republie les examens enregistrés par le dernier `npm run sync`, sans Moodle ni OCR (Google est alors obligatoire) ; sans lecture préalable, il n'efface rien.

### Limites

- Une valeur fausse mais plausible, lue de façon cohérente, n'est pas détectable : vérifier avec le lien « Calendrier d'origine » présent dans chaque événement, puis corriger dans le fichier.
- Si la capture est trop petite ou sans quadrillage, la lecture est dégradée (mode « fallback ») : tout est marqué « À vérifier » et les logs l'indiquent.
- Les libellés viennent d'une image tierce : l'OCR peut déformer un nom, ce qui change l'identifiant de l'événement (l'ancien est supprimé, le nouveau créé).

## Intégration Claude Desktop

Dans `claude_desktop_config.json` (Windows : `%APPDATA%\Claude\claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "cesi": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--init",
        "--shm-size=1g",
        "-v",
        "cesibridge-data:/data",
        "--env-file",
        "D:/My Project/Node/CESIBridge/.env",
        "cesibridge:latest"
      ]
    }
  }
}
```

Redémarre Claude Desktop : les outils `cesi_*`, `moodle_*` et `scholarvox_get_toc` doivent apparaître. Pour la reconnexion automatique, ajouter `CESI_EMAIL` et `CESI_PASSWORD` au `.env`.

## Intégration Claude Code

`.mcp.json` déclare le serveur `cesibridge` (`node --env-file-if-exists=.env src/server.js`, lancé depuis le dossier du projet) à côté de `playwright`. `.claude/settings.json` autorise les outils en lecture ; `moodle_download_resource` demande confirmation. `CLAUDE.md` demande d'utiliser d'abord ces outils, Playwright servant à l'exploration.

⚠️ Antivirus ou proxy qui inspecte le HTTPS (ex. Avast Web Shield) : Node refuse les certificats ré-signés (`unable to verify the first certificate`) alors que Chromium utilise le magasin Windows. Définir `NODE_EXTRA_CA_CERTS` vers le certificat racine de l'outil (Avast : `C:\ProgramData\Avast Software\Avast\wscert.pem`) comme **variable d'environnement utilisateur** (`setx NODE_EXTRA_CA_CERTS "…"`), puis redémarrer l'application qui lance Claude Code. Alternative : exclure `node.exe` de l'analyse HTTPS de l'antivirus.

## Exploration avec Claude Code (Playwright MCP)

`.mcp.json` déclare un serveur `playwright` ([Playwright MCP](https://github.com/microsoft/playwright-mcp), version figée en devDependency) qui navigue avec la session CESIBridge :

- `--storage-state data/state.json` + `--isolated` : la session est chargée en mémoire, le fichier n'est jamais modifié ;
- `--allowed-origins` : ENT, `wayf.cesi.fr`, ADFS, Moodle, Scholarvox et Scenari (contenus des activités LTI) uniquement (les autres requêtes sont bloquées) ;
- `.claude/settings.json` : navigation et lecture autorisées, clics et saisies soumis à confirmation, exécution de code et envoi de fichiers interdits.

Mise en place :

1. `npm install`, puis `npm run mcp:browsers` (Chromium attendu par Playwright MCP).
2. Une session valide : `npm run sync` (login automatique).
3. Ouvrir Claude Code dans le projet et approuver le serveur `playwright` au premier lancement.

⚠️ Le modèle agit avec votre compte : le texte des pages (forums, devoirs) peut contenir des instructions, à ne pas suivre. Les résultats de l'exploration sont dans [docs/exploration.md](docs/exploration.md).

## Développement

```bash
npm test        # unitaires + intégration (serveur lancé en sous-processus)
npm run lint
npm run format
```

La version de `playwright` est épinglée (sans `^`) : elle doit être identique au tag de l'image `mcr.microsoft.com/playwright` (`ARG PLAYWRIGHT_VERSION` dans `docker/Dockerfile`). Pour changer de version, modifier les deux ensemble.

### Checklist de test manuel

1. Login via noVNC → message « Session enregistrée ».
2. `cesi_check_session` → `valid`.
3. `docker run --rm -v cesibridge-data:/data alpine rm /data/state.json` → `cesi_check_session` = `absent`.
4. Session expirée côté CESI → `expired`.
5. Examens (`CESI_FILIERE` et `CESI_NIVEAU` définis) : `npm run sync` journalise le nombre d'examens et le mode de lecture ; comparer les événements avec l'image du lien « Calendrier d'origine » ; relancer sans changement → « source inchangée » ; `npm run publish` republie sans OCR.

## Dépannage

| Symptôme                                      | Cause probable / solution                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `expired` juste après le login                | `CESI_LOGGED_IN_HOSTS` incomplet : relancer `npm run explore`.                                                   |
| `absent` alors que le login a réussi          | Volume différent : vérifier `-v cesibridge-data:/data` dans la config du client MCP.                             |
| noVNC inaccessible                            | Oubli de `--service-ports`, ou port 6080 déjà pris.                                                              |
| `Executable doesn't exist at /ms-playwright…` | Versions Playwright décalées entre `package.json` et l'image : les réaligner et rebuild.                         |
| Chromium plante dans le conteneur             | Mémoire partagée insuffisante : garder `--shm-size=1g`.                                                          |
| `Configuration invalide` au démarrage         | Variable manquante dans `.env` (le détail est sur stderr).                                                       |
| `fichier de corrections invalide`             | JSON mal formé ou entrée refusée : le message cite le champ (`[index.champ]`) ; voir « Calendrier des examens ». |
| `aucun examen lu pour …`                      | Filière ou niveau absents de l'image, ou capture illisible : base inchangée ; vérifier `CESI_FILIERE`.           |
| `certificat TLS non vérifiable`               | Antivirus/proxy qui inspecte le HTTPS : définir `NODE_EXTRA_CA_CERTS` (voir « Intégration Claude Code »).        |

## Sécurité

- `state.json` donne accès à ton compte CESI : volume Docker dédié, droits 600, jamais dans Git.
- noVNC n'est publié que sur `127.0.0.1` ; le conteneur de login est éphémère (`--rm`). VNC n'a pas de mot de passe : ne jamais exposer le port 6080 sur le réseau.
- `.env` reste hors de l'image (`--env-file`).
- Les réponses des outils ne contiennent jamais de cookie, de `sesskey` ni d'URL à jetons ; les liens renvoyés pointent uniquement vers Moodle.
- `moodle_download_resource` n'accepte que `https://moodle.cesi.fr` (`/pluginfile.php`, `/mod/resource/view.php`, `/mod/folder/`), vérifie chaque redirection, assainit le nom de fichier et n'écrase rien.
- `scholarvox_get_toc` ne lit que le sommaire public, jamais le texte des livres (licence).
- Vérifie que la charte informatique du CESI autorise l'automatisation de ton propre compte.
