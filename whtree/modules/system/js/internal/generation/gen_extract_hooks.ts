import { resolveResource } from "@webhare/services";
import { matchesThisServer, type GenerateContext } from "./shared";
import type { ModDefYML } from "@webhare/services/src/moduledefparser";
import { addModule } from "@webhare/services/src/naming";

export type BackendHook = {
  name: string;
  screen: string;
  when?: {
    wrdSchema?: string;
  };
  addActions?: Array<{
    title: string;
    category: string;
    onExecute: string;
  }>;
  tabsExtension?: string;
};

export type HooksExtract = {
  backendHooks: BackendHook[];
};

function getYMLBackendHooks(modYml: ModDefYML): BackendHook[] {
  const hooks: BackendHook[] = [];
  for (const [key, hook] of Object.entries(modYml.backendHooks!)) {
    if (hook.ifWebHare && !matchesThisServer(hook.ifWebHare, { unsafeEnv: true }))
      continue;

    const name = `${modYml.module}:${key}`;

    hooks.push({
      name,
      screen: hook.screen,
      when: hook.when ? {
        wrdSchema: hook.when.wrdSchema ? addModule(modYml.module, hook.when.wrdSchema) : undefined
      } : undefined,
      tabsExtension: hook.tabsExtension ? resolveResource(modYml.baseResourcePath, hook.tabsExtension) : undefined,
      addActions: hook.addActions?.map(action => ({
        title: `:${action.title}`,
        category: action.category,
        onExecute: resolveResource(modYml.baseResourcePath, action.onExecute)
      }))
    });
  }
  return hooks;
}

export async function generateHooks(context: GenerateContext): Promise<string> {
  const retval: HooksExtract = {
    backendHooks: []
  };

  for (const mod of context.moduledefs) {
    if (mod.modYml?.backendHooks)
      retval.backendHooks.push(...getYMLBackendHooks(mod.modYml));
  }
  return JSON.stringify(retval, null, 2) + "\n";
}
