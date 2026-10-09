# CESIBridge

Serveur MCP (stdio) qui vérifie la session SSO CESI avec Playwright, dockerisé.

| Outil                | Rôle                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `cesi_check_session` | Charge l'ENT en headless avec la session enregistrée : `valid`, `expired`, `absent`, `invalid` ou `error`. |
| `cesi_login`         | Renvoie la procédure de login manuel (le serveur n'a pas d'écran).                                         |

Aucun identifiant n'est stocké : seule la session (`storageState` : cookies + localStorage) est conservée, dans le volume Docker `cesibridge-data`.

## Architecture

```
src/config.js            variables d'env validées (zod), échec immédiat si invalides
src/browser/session.js   lecture/écriture du storageState (600), navigateur partagé lancé à la demande
src/browser/sso.js       détection « connecté » par hôte final après redirections
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

Redémarre Claude Desktop : `cesi_check_session` et `cesi_login` doivent apparaître.

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

## Dépannage

| Symptôme                                      | Cause probable / solution                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `expired` juste après le login                | `CESI_LOGGED_IN_HOSTS` incomplet : relancer `npm run explore`.                           |
| `absent` alors que le login a réussi          | Volume différent : vérifier `-v cesibridge-data:/data` dans la config du client MCP.     |
| noVNC inaccessible                            | Oubli de `--service-ports`, ou port 6080 déjà pris.                                      |
| `Executable doesn't exist at /ms-playwright…` | Versions Playwright décalées entre `package.json` et l'image : les réaligner et rebuild. |
| Chromium plante dans le conteneur             | Mémoire partagée insuffisante : garder `--shm-size=1g`.                                  |
| `Configuration invalide` au démarrage         | Variable manquante dans `.env` (le détail est sur stderr).                               |

## Sécurité

- `state.json` donne accès à ton compte CESI : volume Docker dédié, droits 600, jamais dans Git.
- noVNC n'est publié que sur `127.0.0.1` ; le conteneur de login est éphémère (`--rm`). VNC n'a pas de mot de passe : ne jamais exposer le port 6080 sur le réseau.
- `.env` reste hors de l'image (`--env-file`).
- Les réponses des outils ne contiennent jamais de cookie ni d'URL complète (seulement l'hôte).
- Vérifie que la charte informatique du CESI autorise l'automatisation de ton propre compte.
