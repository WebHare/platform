import type { ModuleQualifiedName } from "@webhare/services/src/naming";
import type { GenerateContext } from "./shared";
import { elements, getAttr, getQualifiedAttr } from "./xmlhelpers";

export type UserRightDefinition = {
  /** Fully qualified name */
  name: ModuleQualifiedName;
  /** Name of right implying us */
  impliedBy: ModuleQualifiedName;
  /** Object target for this right */
  target: ModuleQualifiedName | null;
};

export type RightsTargetObject = {
  /** Fully qualified name */
  name: ModuleQualifiedName;
  /** Target table */
  table: string;
  /** Parent column in that table */
  parentColumn: string | null;
};

export interface UserRights {
  rights: UserRightDefinition[];
  targets: RightsTargetObject[];
}

export async function generateUserRights(context: GenerateContext): Promise<string> {
  const retval: UserRights = {
    rights: [],
    targets: []
  };

  for (const mod of context.moduledefs) {
    const rights = mod.modXml?.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "rights")[0];
    if (!rights)
      continue;

    for (const objecttype of elements(rights.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "objecttype"))) {
      let table = getAttr(objecttype, "table");
      if (!table)
        continue;

      if (table.startsWith(".")) //prefix with module name as a schema name
        table = mod.name + table;

      const objType: RightsTargetObject = {
        name: `${mod.name}:${getAttr(objecttype, "name")}`,
        parentColumn: getAttr(objecttype, "parentfield", "") || null,
        table
      };

      retval.targets.push(objType);
    }

    for (const right of elements(rights.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "right"))) {
      const impliedByNode = right.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "impliedby")[0];
      if (!impliedByNode)
        continue;
      const impliedBy = getQualifiedAttr(mod.name, impliedByNode, "right");
      if (!impliedBy)
        continue;

      const userright: UserRightDefinition = {
        name: `${mod.name}:${getAttr(right, "name")}`,
        impliedBy,
        target: getQualifiedAttr(mod.name, right, "objecttype") || null
      };

      retval.rights.push(userright);
    }
  }
  return JSON.stringify(retval);
}
