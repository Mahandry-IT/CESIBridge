import { LOGIN_COMMAND, NOVNC_URL } from '../commands.js';

// Le serveur MCP tourne sans écran (stdio) : le login manuel se fait dans le service Compose `login`.
export function loginInstructions() {
  return [
    "Connexion manuelle requise : le serveur MCP n'a pas d'écran.",
    `1. Dans le dossier du projet, lance : ${LOGIN_COMMAND}`,
    `2. Ouvre ${NOVNC_URL} dans ton navigateur et connecte-toi (MFA compris, 5 min max).`,
    '3. La session est enregistrée automatiquement, le conteneur se ferme seul.',
    '4. Relance cesi_check_session pour vérifier.',
  ].join('\n');
}

export function registerLogin(server) {
  server.registerTool(
    'cesi_login',
    {
      title: 'Se connecter au CESI',
      description:
        'Renvoie la procédure pour (re)créer la session CESI : login manuel via noVNC dans Docker.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({ content: [{ type: 'text', text: loginInstructions() }] }),
  );
}
