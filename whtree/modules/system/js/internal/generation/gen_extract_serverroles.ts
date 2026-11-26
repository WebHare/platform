import type { ModuleQualifiedName } from "@webhare/services/src/naming";
import type { GenerateContext } from "./shared";
import { typedEntries } from "@webhare/std";
import { builtinServerRoles } from "./gen_config_nodb";

export type ServerRoleDescriptor = {
  /** Fully qualified name, eg webhare_testsuite:primary */
  name: ModuleQualifiedName;
  /** Title tid (':' prefixed for a literal title). Empty if not set */
  title: string;
  /** Built-in role, derived from the environment and DTAP stage. These can't be stored or set */
  isBuiltin: boolean;
};

export type ServerRolesExtract = {
  roles: ServerRoleDescriptor[];
};

export async function generateServerRoles(context: GenerateContext): Promise<string> {
  const retval: ServerRolesExtract = {
    roles: []
  };

  for (const mod of context.moduledefs)
    for (const [tag, role] of typedEntries(mod.modYml?.serverRoles || {})) {
      const name = `${mod.name}:${tag}` as const;
      retval.roles.push({
        name,
        title: context.parseYMLTid(mod, role, "title"),
        isBuiltin: builtinServerRoles.includes(name)
      });
    }

  return JSON.stringify(retval, null, 2) + "\n";
}
