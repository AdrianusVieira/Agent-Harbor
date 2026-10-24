import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const harborRoot = fileURLToPath(new URL("../", import.meta.url));
const marker = " # agent-harbor";
const scripts = {
  PermissionRequest: "claude-permission-request.ts",
  SessionStart: "claude-session-start.ts",
  Stop: "claude-reply-ready.ts",
  UserPromptSubmit: "claude-prompt-submit.ts",
} as const;

type HookName = keyof typeof scripts;
type Registration = {
  hooks: { async: true; command: string; type: "command" }[];
  matcher?: string;
};

// Single quotes keep spaces, dollar signs, and shell substitutions literal.
function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function createClaudeHooks(root = harborRoot, node = process.execPath) {
  return Object.fromEntries(
    Object.entries(scripts).map(([event, script]) => [
      event,
      [
        {
          hooks: [
            {
              async: true,
              command:
                [
                  node,
                  join(root, "node_modules/tsx/dist/cli.mjs"),
                  join(root, "scripts", script),
                ]
                  .map(quote)
                  .join(" ") + marker,
              type: "command",
            },
          ],
          ...(event === "PermissionRequest"
            ? { matcher: "*" }
            : event === "SessionStart"
              ? { matcher: "startup" }
              : {}),
        },
      ],
    ]),
  ) as Record<HookName, Registration[]>;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Only handlers bearing our command marker belong to this installer.
export function updateClaudeSettings(
  input: unknown,
  mode: "install" | "uninstall",
) {
  if (!object(input)) throw new Error("Settings must contain a JSON object.");
  const settings = structuredClone(input);
  if (settings.hooks !== undefined && !object(settings.hooks)) {
    throw new Error("Settings hooks must be an object.");
  }
  const hooks: Record<string, unknown[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    if (!Array.isArray(groups))
      throw new Error(`Invalid hook groups for ${event}.`);
    hooks[event] = groups.flatMap((group) => {
      if (!object(group) || !Array.isArray(group.hooks)) {
        throw new Error(`Invalid hook group for ${event}.`);
      }
      const retained = group.hooks.filter(
        (hook) =>
          !(
            object(hook) &&
            hook.type === "command" &&
            typeof hook.command === "string" &&
            hook.command.endsWith(marker)
          ),
      );
      if (retained.length === group.hooks.length) return [group];
      return retained.length ? [{ ...group, hooks: retained }] : [];
    });
    if (!hooks[event].length && groups.length) delete hooks[event];
  }
  if (mode === "install") {
    for (const [event, groups] of Object.entries(createClaudeHooks())) {
      hooks[event] = [...(hooks[event] ?? []), ...groups];
    }
  }
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  return settings;
}
