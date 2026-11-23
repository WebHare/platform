import type { ModuleQualifiedName } from "@webhare/services/src/naming";
import type { GenerateContext } from "./shared";
import { typedEntries } from "@webhare/std";

export type ServerRoleDescriptor = {
  /** Fully qualified name, eg webhare_testsuite:primary */
  name: ModuleQualifiedName;
  /** Title tid (':' prefixed for a literal title). Empty if not set */
  title: string;
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
      retval.roles.push({
        name: `${mod.name}:${tag}`,
        title: context.parseYMLTid(mod, role, "title")
      });
    }

  return JSON.stringify(retval, null, 2) + "\n";
}
