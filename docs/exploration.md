# Exploration Moodle et Scholarvox

Résultats de la phase 1 (octobre 2026), base des outils CESIBridge de la phase 2. Aucun jeton, `sesskey` ni identifiant personnel n'est consigné ici.

## Domaines

| Domaine               | Rôle                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `ent.cesi.fr`         | ENT : point d'entrée, liens « 31 - Moodle One Cesi » et « 32 - CyberLibris » (`target="_blank"`) |
| `wayf.cesi.fr`        | Page de choix du fournisseur d'identité (champ `#login`, e-mail)                                 |
| `sts.viacesi.fr`      | ADFS (`#userNameInput`, `#passwordInput`)                                                        |
| `moodle.cesi.fr`      | Moodle                                                                                           |
| `univ.scholarvox.com` | Scholarvox (Cyberlibris)                                                                         |
| `scenari.cesi.fr`     | Contenus de cours Scenari (activités LTI ouvertes depuis Moodle)                                 |

## Moodle

### Accès

- Le lien de l'ENT a un `href` **fixe** : `https://moodle.cesi.fr/login/index.php?authCAS=…`. On peut y aller directement, sans cliquer ni gérer le nouvel onglet.
- Ce lien SSO (`authCAS=CAS`) passe par `wayf.cesi.fr/login` (champ e-mail `input#login`), puis `sts.viacesi.fr/adfs/ls/`, puis `moodle.cesi.fr/`. Avec une session ENT valide, on arrive directement sur Moodle.
- ⚠️ Ouvrir `https://moodle.cesi.fr/my/` sans session Moodle mène au formulaire de connexion **propre à Moodle**, où `#login` est un `<form>` et non le champ e-mail. Il ne faut pas le remplir : passer toujours par le lien SSO. `autoLogin` cible donc `input#login`.
- **Reconnexion sans mot de passe** : si la session ADFS est encore valide (après le login ENT), ADFS ne redemande pas le mot de passe. `autoLogin` doit gérer ce cas : après `#login`, attendre soit `#passwordInput`, soit l'arrivée sur Moodle.
- La page de connexion Moodle (`/login/index.php`) est déjà exclue des pages « connectées » (préfixe `/login`).

### API interne (`/lib/ajax/service.php`)

Appelée depuis une page Moodle connectée : `POST {wwwroot}/lib/ajax/service.php?sesskey={M.cfg.sesskey}&info={méthode}` avec le corps `[{ index: 0, methodname, args }]`.

| Méthode                                                                                           | Statut                   | Usage                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `core_course_get_enrolled_courses_by_timeline_classification` (`classification: 'all', limit: 0`) | ✅                       | Cours où l'étudiant est inscrit : `id`, `fullname`, `shortname`, `coursecategory`, `viewurl`, `startdate`, `enddate`, `progress` |
| `core_calendar_get_action_events_by_timesort` (`timesortfrom`, `timesortto`, `limitnum`)          | ✅                       | Échéances : `id`, `name`, `modulename`, `activityname`, `timesort`, `url`, `course`…                                             |
| `core_courseformat_get_state` (`courseid`)                                                        | ✅                       | Chaîne JSON : `section[]` et `cm[]` (`id`, `name`, `modname`, `sectionid`, `url`, `uservisible`…)                                |
| `mod_url_get_urls_by_courses`                                                                     | ❌ `servicenotavailable` | Pas exposée en AJAX                                                                                                              |

### Ressources de type URL

- La vraie destination s'obtient avec `GET /mod/url/view.php?id={cmid}&redirect=1` sans suivre la redirection : en-tête `Location`, ou à défaut le lien `.urlworkaround` de la page.
- Les 167 ressources URL des cours inscrits ont toutes été résolues. Aucune ne pointe vers Scholarvox.

### Liens Scholarvox dans les cours

- Ils se trouvent dans le **contenu HTML des cours** (blocs « Zone texte et média »), pas dans des ressources URL.
- Format : `https://univ.scholarvox.com/reader/docid/{docid}/page/{n}`, avec `docid` sur 8 chiffres.
- Repérage : liens `a[href*="univ.scholarvox.com/reader/docid/"]` dans la page du cours (`/course/view.php?id=…`).

## Scholarvox

- Le lien ENT `https://univ.scholarvox.com/cesiwayf` mène à un formulaire de connexion propre à Scholarvox (`#frm-login`, `#username`, `#password`, envoi vers `/login_check`), pas au SSO CESI.
- **Le sommaire ne demande pas de connexion** : `GET https://univ.scholarvox.com/catalog/toc/{docid}` renvoie du JSON public.
  - Forme : tableau plat `[{ item, name, page, level }]`, avec `level` qui porte la hiérarchie (sous forme de chaîne). Exemple observé : 100 entrées.
  - Pas besoin de session Scholarvox pour l'outil « sommaire ».
- Autres appels JSON du lecteur (non utilisés, contenu sous licence) : `/reader/vpages/{docid}`, `/note/list/{docid}`, `/pagemark/list/{docid}`.
- Titre du livre : `<title>` de la page du lecteur (`{titre} - ScholarVox Université`). Pour les auteurs, une page catalogue reste à identifier.

## Conséquences pour la phase 2

1. `autoLogin` : gérer la reconnexion ADFS sans mot de passe, et la page `wayf.cesi.fr`.
2. `CESI_LOGGED_IN_HOSTS` : ajouter `moodle.cesi.fr`.
3. Moodle : uniquement l'API AJAX ; l'URL d'accès est fixe (pas de clic dans l'ENT).
4. Scholarvox : outil sommaire avec `/catalog/toc/{docid}`, sans connexion ; `docid` extrait des liens présents dans le HTML des cours.
5. Le formulaire de connexion Scholarvox n'est pas nécessaire pour ce périmètre.
