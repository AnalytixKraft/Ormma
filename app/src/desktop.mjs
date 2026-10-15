/* When the app runs as the desktop app — the Mac or Windows download, which
 * desktop/launcher.mjs starts — the few lines that tell someone what to do
 * on the computer itself say it the desktop app's way: its settings file
 * instead of .env, its own commands instead of scripts/ and docker compose.
 * The launcher says where things are:
 *
 *   ORMMA_DESKTOP  mac | windows | linux
 *   ORMMA_COMMAND  the Ormma program, to run from a terminal
 *   ORMMA_CONFIG   its settings file (the desktop app's .env)
 *   ORMMA_LOGS     the folder its logs are in
 *
 * null when it runs from the repo — Docker, or scripts/native on a Mac.
 * Read when asked, not at import, so a test can pass its own. */

export function desktopHints(env = process.env) {
  const platform = env.ORMMA_DESKTOP;
  if (!platform) return null;
  const command = env.ORMMA_COMMAND || "Ormma";
  const windows = platform === "windows";
  // Quoted for the shell it is typed into: the path may hold spaces.
  const line = (what) => (windows ? `"${command}" ${what}` : `'${command.replaceAll("'", "'\\''")}' ${what}`);
  const terminal = windows ? "Command Prompt" : "Terminal";
  return {
    config: env.ORMMA_CONFIG || "ormma.env, in Ormma’s data folder",
    logs: env.ORMMA_LOGS || "Ormma’s logs folder",
    // Steps: a menu to follow, or a line to type.
    reset: windows ? { menu: "choose Start menu → Ormma → Reset Ormma password" } : { command: line("reset-password"), terminal },
    restart: windows ? { menu: "choose Start menu → Ormma → Stop Ormma, then open Ormma again" } : { command: line("restart"), terminal },
  };
}

/* A step as the end of a sentence: "…, run '…' restart in Terminal". */
export const stepText = (step) => step.menu ?? `run ${step.command} in ${step.terminal}`;
