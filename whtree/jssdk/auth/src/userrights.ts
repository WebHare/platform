import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import type { UserRightDefinition } from "@mod-system/js/internal/generation/gen_extract_userrights";
import { UUIDToWrdGuid } from "@webhare/hscompat";
import { checkModuleScopedName, type ModuleQualifiedName } from "@webhare/services/src/naming";
import { appendToArray, throwError } from "@webhare/std";
import { db, query, escapePGIdentifier } from "@webhare/whdb";
import { encodeWRDGuid } from "@webhare/wrd/src/accessors";

type GlobalRight = "system:sysop" | "system:supervisor" | ModuleQualifiedName;
type TargettedRight = "system:fs_fullaccess" | ModuleQualifiedName;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RightsDB = any;

const authobjectTypeUser = 1;
// const authobjectTypeRole = 3;

export interface InformationSchema {
  "information_schema.table_constraints": {
    constraint_name: string;
    constraint_schema: string;
    table_schema: string;
    table_name: string;
    constraint_type: string;
  };

  "information_schema.key_column_usage": {
    constraint_name: string;
    constraint_schema: string;
    table_schema: string;
    table_name: string;
    column_name: string;
  };

  "information_schema.constraint_column_usage": {
    constraint_name: string;
    constraint_schema: string;
    table_schema: string;
    table_name: string;
    column_name: string;
  };
}

export interface AuthorizationInterface {
  /** Check whether the user has a global right
   * @param right The global right to check, eg system:sysop (but not eg system:fs_fullaccess which requires hasRightOn)
   */
  hasRight(right: GlobalRight): Promise<boolean>;
  /** Check whether the user has a targetted right on a specific object (or inherited through its parnet)
   * @param right The targetted right to check, eg system:sysop (but not eg system:fs_fullaccess which requires hasRightOn)
   * @param objectId The target object's id, or null to check for access to all objects
   */
  hasRightOn(right: TargettedRight, objectId: number | null): Promise<boolean>;
  /** Check whether the user has a targetted right on ANY object of the type
   * @param right The targetted right to check, eg system:sysop (but not eg system:fs_fullaccess which requires hasRightOn)
   */
  hasRightOnAny(right: TargettedRight): Promise<boolean>;
  /** Filter objects on which the user has the requested right (a 'bulk' hasRightOn)
   * @param right The targetted right to check, eg system:sysop (but not eg system:fs_fullaccess which requires hasRightOn)
   */
  filterRightOn(right: TargettedRight, objectIds: number[]): Promise<number[]>;
}

/** Describe a right and its implied-by chain */
function getImpliedChain(right: ModuleQualifiedName): UserRightDefinition[] {
  const extract = getExtractedConfig("userrights");
  const chain: UserRightDefinition[] = [];

  for (; ;) {
    // eslint-disable-next-line @typescript-eslint/no-loop-func
    const match = extract.rights.find(r => r.name === right);
    if (!match)
      break;

    if (match.target && chain[0] && match.target !== chain[0].target) //verify target consistency
      throw new Error(`Inconsistent implied-by chain - right '${match.name}' refers to target object type '${match.target}' but right '${right}' refers to target object type '${chain[0].target}'`);

    chain.push(match);
    if (!match.impliedBy || chain.some(_ => _.name === match.impliedBy))
      break;

    right = match.impliedBy; //on to the next one
  }
  return chain;
}

async function findRightsTable(tableRef: string) {
  const [schema, table] = tableRef.split(".");
  const result = await db<InformationSchema>()
    .selectFrom('information_schema.table_constraints as tc')
    .innerJoin('information_schema.key_column_usage as kcu', (join) =>
      join
        .onRef('tc.constraint_name', '=', 'kcu.constraint_name')
        .onRef('tc.constraint_schema', '=', 'kcu.constraint_schema')
    )
    .innerJoin('information_schema.constraint_column_usage as ccu', (join) =>
      join
        .onRef('tc.constraint_name', '=', 'ccu.constraint_name')
        .onRef('tc.constraint_schema', '=', 'ccu.constraint_schema')
    )
    .select(['tc.table_name as referencing_table'])
    .where('tc.constraint_type', '=', 'FOREIGN KEY')
    .where('ccu.table_schema', '=', schema)
    .where('ccu.table_name', '=', table)
    .where('ccu.column_name', '=', 'id')
    .where('tc.table_schema', '=', 'system_rights')
    .execute();

  if (result.length > 1)
    throw new Error(`Multiple system_rights tables seem to handle table ${tableRef} : ${result.map(r => r.referencing_table).join(", ")}`);
  if (result.length === 0) //not installed yet, so just assume not table to check
    return null;

  return `system_rights.${result[0].referencing_table}`;
}

async function gatherParents(tableRef: string, parentColumn: string, objectId: number): Promise<number[]> {
  if (!objectId)
    return [];

  const [schema, table] = tableRef.split(".");
  const path = await query<{ id: number }>(`
      WITH RECURSIVE path_to_root AS (
        SELECT
          id,
          ${escapePGIdentifier(parentColumn)} AS parent,
          ARRAY[id] AS path_ids  -- Track visited IDs
        FROM ${escapePGIdentifier(schema)}.${escapePGIdentifier(table)}
        WHERE id = $1

        UNION ALL

        SELECT
          f.id,
          f.${escapePGIdentifier(parentColumn)} AS parent,
          path_ids || f.id
        FROM ${escapePGIdentifier(schema)}.${escapePGIdentifier(table)} AS f
        JOIN path_to_root p ON f.id = p.parent
        WHERE NOT f.id = ANY(p.path_ids)  -- Prevent cycles
  ) SELECT id FROM path_to_root;
`, [objectId]);

  return path.rows.map(row => row.id);
}

class WRDEntityAuthorization implements AuthorizationInterface {
  constructor(private entityId: number) {
  }

  private async expandAuthObjects(authobject: number) {
    const objs = [authobject];
    const roles = await db<PlatformDB>().selectFrom("system.rolegrants").where("grantee", "=", authobject).select("role").execute();
    //FIXME should also check deactivated 'If true, authobject is no longer visible in any usermgmt schema (currently used only for roles that only exist with a limitdate in WRD)'
    appendToArray(objs, roles.map(r => r.role));
    return objs;
  }

  private async getMyAuthObjects(): Promise<number[]> {
    const userguid = await db<PlatformDB>().selectFrom("wrd.entities").where("id", "=", this.entityId).select("guid").executeTakeFirst() ?? throwError(`Entity with ID ${this.entityId} not found`);
    const wrdHexGuid = UUIDToWrdGuid(encodeWRDGuid(userguid.guid));

    const authobject = await db<PlatformDB>().selectFrom("system.authobjects").where("guid", "=", wrdHexGuid).select(["id", "type"]).executeTakeFirst();
    if (!authobject)
      return [];

    const expanded: number[] = authobject.type === authobjectTypeUser ? await this.expandAuthObjects(authobject.id) : [authobject.id];
    return expanded;
  }

  private async executeHasRight(right: TargettedRight, type: "global" | "target" | "any", objectId: number | null): Promise<boolean> {
    // We assume that if right has a target implied-by {chain must also refer to the same objecttype OR be a global right
    const chain = getImpliedChain(right);
    if (!chain.length)
      throw new Error(`No such right '${right}'`);

    let rightsTable: string | null = null;
    const matchObjects: number[] = [];

    if (type === "global") {
      if (chain[0].target)
        throw new Error(`Right '${right}' is not a global right but requires an object of type '${chain[0].target}'`);
    } else {
      if (!chain[0].target)
        throw new Error(`Right '${right}' is a global right, use hasRight instead`);

      const objType = getExtractedConfig("userrights").targets.find(t => t.name === chain[0].target) ?? throwError(`No such target object type '${chain[0].target}' for right '${right}'`);
      rightsTable = await findRightsTable(objType.table);

      if (objectId) //not looking for an 'all' reference
        if (objType.parentColumn)
          matchObjects.push(...await gatherParents(objType.table, objType.parentColumn, objectId));
        else
          matchObjects.push(objectId);
    }

    const expanded = await this.getMyAuthObjects();
    if (!expanded.length)
      return false; //if you don't exist you obviously have no rights

    for (const rightEntry of chain) {
      const [module, rightname] = checkModuleScopedName(rightEntry.name);
      const matchRightId = await db<PlatformDB>().selectFrom("system.modules").where("system.modules.name", "=", module).
        innerJoin("system.module_rights", "system.module_rights.module", "system.modules.id").where("system.module_rights.name", "=", rightname).
        select("system.module_rights.id").executeTakeFirst() ?? throwError(`Right ${right} not installed in the database`);

      if (rightEntry.target) {
        if (!rightsTable)
          continue; //we never found the righttable, so skip this right chec
      }

      let grantQuery = db<RightsDB>().selectFrom(rightEntry.target ? rightsTable! : "system_rights.global_rights").where("right", "=", matchRightId.id).where("grantee", "in", expanded);
      if (type === "target") ///we desire a grant for either the object, one of its parents, or just null to match all
        grantQuery = grantQuery.where(eb => eb.or([eb("object", "in", matchObjects), eb("object", "is", null)]));

      if (await grantQuery.select("id").executeTakeFirst())
        return true;
    }
    return false;
  }

  async hasRight(right: GlobalRight): Promise<boolean> {
    return await this.executeHasRight(right, "global", null);
  }

  async hasRightOn(right: TargettedRight, objectId: number | null): Promise<boolean> {
    if (objectId === 0)
      throw new Error("Cannot check rights on object 0 - pass 'null' instead"); //safety check - it's a foreign key in WHDB so we expect 0 to be invalid

    return await this.executeHasRight(right, "target", objectId);
  }

  async hasRightOnAny(right: TargettedRight): Promise<boolean> {
    return await this.executeHasRight(right, "any", null);
  }

  async filterRightOn(right: TargettedRight, objectIds: number[]): Promise<number[]> {
    const out: number[] = [];
    // TODO: Optimize this is a naive implementation just to run/pass tests. HS did it
    for (const objectId of [...new Set(objectIds)])
      if (await this.executeHasRight(right, "target", objectId))
        out.push(objectId);
    return [...new Set(out)].toSorted((lhs, rhs) => lhs - rhs);
  }
}

export function getAuthorizationInterface(id: number): AuthorizationInterface {
  return new WRDEntityAuthorization(id);
}
