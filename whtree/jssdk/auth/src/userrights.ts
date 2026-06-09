import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import type { UserRightDefinition } from "@mod-system/js/internal/generation/gen_extract_userrights";
import { defaultDateTime, UUIDToWrdGuid, wrdGuidToUUID } from "@webhare/hscompat";
import { parseModuleQualifiedName, type ModuleQualifiedName } from "@webhare/services/src/naming";
import { appendToArray, throwError } from "@webhare/std";
import { db, query, escapePGIdentifier } from "@webhare/whdb";
import { getGuidForEntity } from "@webhare/wrd/src/accessors";
import { getAuthSettings } from "./support";
import type { AnySchemaType } from "@webhare/wrd/src/types";
import type { WRDSchemaType } from "@webhare/wrd";

export type GlobalRight = "system:sysop" | "system:supervisor" | ModuleQualifiedName;
export type TargettedRight = "system:fs_fullaccess" | ModuleQualifiedName;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RightsDB = any;

const authobjectTypeUser = 1;
// const authobjectTypeRole = 3;

type AuthObjectType = typeof authobjectTypeUser | 2 | 3; //TODO add constants for the others too as soon was we use them
type AuthObjectRef = { id: number; type: AuthObjectType };

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
   * @param object The target object's id or "all"/"any" to verify access to all/any object(s)
   */
  hasRightOn(right: TargettedRight, object: number | "all" | "any"): Promise<boolean>;
  /** Filter objects on which the user has the requested right (a 'bulk' hasRightOn)
   * @param right The targetted right to check, eg system:sysop (but not eg system:fs_fullaccess which requires hasRightOn)
   */
  filterRightOn(right: TargettedRight, objectIds: number[]): Promise<number[]>;

  /** List accessible root objects for a list of rights
      @param rights Rights to check. If the user has any of these rights (possibly implied) on an object, it will be returned
      @return The list of accessible object roots. "all" if the user has rights on all objects including any future objects
  */
  getRootObjects(rights: TargettedRight[]): Promise<number[] | "all">;
}

type ChainEntry = UserRightDefinition & {
  databaseId: number | null;
};

/** Map succesful rights lookups forever, they shouldn't change once created in normal WebHare operation (TODO: invalidate anyway on rights changes just in case) */
let rightsCache: Map<ModuleQualifiedName, number> | null;

/** Map succesful right table lookups forever, they shouldn't change once created in normal WebHare operation (TODO: invalidate anyway on rights changes just in case) */
let rightsTableCache: Map<string, string> | null;

/** Describe a right and its implied-by chain */
async function describeChain(right: ModuleQualifiedName): Promise<{
  chain: ChainEntry[];
  target?: string;
  targetTable?: string;
  rightsTable?: string;
  parentColumn?: string | null;
}> {
  const extract = getExtractedConfig("userrights");
  const chain: ChainEntry[] = [];
  rightsCache ||= new Map();

  for (; ;) {
    // eslint-disable-next-line @typescript-eslint/no-loop-func
    const match = extract.rights.find(r => r.name === right);
    if (!match)
      throw new Error(`No such right '${right}'`);

    if (match.target && chain[0] && match.target !== chain[0].target) //verify target consistency
      throw new Error(`Inconsistent implied-by chain - right '${match.name}' refers to target object type '${match.target}' but right '${right}' refers to target object type '${chain[0].target}'`);

    if (!rightsCache.has(match.name)) {
      const [module, rightname] = parseModuleQualifiedName(match.name);
      //TODO we can probably eternally cache a hit
      const matchRightId = await db<PlatformDB>().selectFrom("system.modules").where("system.modules.name", "=", module).
        innerJoin("system.module_rights", "system.module_rights.module", "system.modules.id").where("system.module_rights.name", "=", rightname).
        select("system.module_rights.id").executeTakeFirst();

      if (matchRightId)
        rightsCache.set(match.name, matchRightId.id);
    }

    chain.push({
      ...match,
      databaseId: rightsCache.get(match.name) || null //we're not eliminating them yet as it might break hasRightOn() validation if it thinks you were requesting a global right but it was just a missing local right
    });


    if (!match.impliedBy || chain.some(_ => _.name === match.impliedBy))
      break;

    right = match.impliedBy; //on to the next one
  }

  if (!chain[0]?.target)
    return { chain };

  //Look up that target
  const objType = extract.targets.find(t => t.name === chain[0].target) ?? throwError(`No such target object type '${chain[0].target}' for right '${right}'`);
  rightsTableCache ||= new Map;
  if (!rightsTableCache?.has(objType.table)) {
    const table = await findRightsTable(objType.table);
    if (table) //only cache succesful lookups
      rightsTableCache.set(objType.table, table);
  }
  const rightsTable = rightsTableCache?.get(objType.table);
  if (!rightsTable)
    return { chain, target: chain[0].target };

  return { chain, target: chain[0].target, rightsTable, targetTable: objType.table, parentColumn: objType.parentColumn };
}

async function findRightsTable(tableRef: string) {
  //TODO This query is pretty slow (easily 200ms). We cache it but we should probably optimize it by going straight for the system catalog
  const [schema, table] = tableRef.split(".");
  const result = (await db<InformationSchema>()
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
    .execute()).filter(r => r.referencing_table.match(/^o_\d*$/)); // HS also filters on o_(number)

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

async function getOrEnsureAuthObject(wrdHexGuid: string, create: boolean): Promise<AuthObjectRef | null> {
  if (create) {
    const insertResult =
      await db<PlatformDB>()
        .insertInto("system.authobjects")
        .returning("id")
        .values({
          name: wrdGuidToUUID(wrdHexGuid), //TODO there isn't a reason to store names here as a user's name or login can be different in different WRD schemas. and potentially violates AVG retention anyway
          guid: wrdHexGuid,
          type: authobjectTypeUser,
          creationdate: new Date(),
          deletiondate: defaultDateTime,
          deactivated: false
        }).onConflict((oc) => oc
          .column("guid")
          .doNothing()).executeTakeFirst();
    if (insertResult?.id)
      return { id: insertResult.id, type: authobjectTypeUser };
  }
  //Newly inserted rows are visible using standard isolation levels so we can just query after conflict
  const match = await db<PlatformDB>().selectFrom("system.authobjects").where("guid", "=", wrdHexGuid).select(["id", "type"]).executeTakeFirst();
  if (create && !match)
    throw new Error(`Failed to create authobject for guid ${wrdHexGuid}`);
  return match as AuthObjectRef || null;
}

class WRDEntityAuthorization implements AuthorizationInterface {
  /** Entity associated with the object. Undefined if not known */
  private entityId: number | undefined;
  /** Authobject associated with the object. Undefined if not known, null we know it's not created yet */
  private authObject: AuthObjectRef | undefined | null;

  constructor(entityId: number | undefined, authObject: AuthObjectRef | null | undefined) {
    if (!entityId && !authObject)
      throw new Error("WRDEntityAuthorization must be constructed with at least an entityId or an authObjectId");

    this.entityId = entityId;
    this.authObject = authObject;
  }

  private async getPrimaryAuthObject(create: true): Promise<{ id: number; type: AuthObjectType }>;
  private async getPrimaryAuthObject(create: false): Promise<{ id: number; type: AuthObjectType } | null>;

  private async getPrimaryAuthObject(create: boolean): Promise<{ id: number; type: AuthObjectType } | null> {
    if (this.authObject || (this.authObject === null && !create))
      return this.authObject;

    if (!this.entityId)
      throw new Error("Should not invoke getPrimaryAuthObject without an entityId");

    const wrdHexGuid = UUIDToWrdGuid((await getGuidForEntity(this.entityId)) ?? throwError(`Entity with ID ${this.entityId} not found`));
    return await getOrEnsureAuthObject(wrdHexGuid, create);
  }

  private async expandAuthObjects(authobject: number) {
    const objs = [authobject];
    const roles = await db<PlatformDB>().selectFrom("system.rolegrants").where("grantee", "=", authobject).select("role").execute();
    //FIXME should also check deactivated 'If true, authobject is no longer visible in any usermgmt schema (currently used only for roles that only exist with a limitdate in WRD)'
    appendToArray(objs, roles.map(r => r.role));
    return objs;
  }

  private async getMyAuthObjects(): Promise<number[]> {
    if (this.authObject === undefined)
      this.authObject = await ((this as WRDEntityAuthorization)["getPrimaryAuthObject"](false));
    if (!this.authObject)
      return [];

    const expanded: number[] = this.authObject.type === authobjectTypeUser ? await this.expandAuthObjects(this.authObject.id) : [this.authObject.id];
    return expanded;
  }

  private async executeHasRight(right: TargettedRight, type: "global" | "target", object: number | "all" | "any"): Promise<boolean> {
    // We assume that if right has a target implied-by {chain must also refer to the same objecttype OR be a global right
    const { chain, rightsTable, parentColumn, targetTable } = await describeChain(right);

    const matchObjects: number[] = [];

    if (type === "global") {
      if (chain[0].target)
        throw new Error(`Right '${right}' is not a global right but requires an object of type '${chain[0].target}'`);
    } else {
      if (typeof object === "number") //not looking for all/any
        if (targetTable && parentColumn)
          matchObjects.push(...await gatherParents(targetTable, parentColumn, object));
        else
          matchObjects.push(object);
    }

    const expanded = await this.getMyAuthObjects();
    if (!expanded.length)
      return false; //if you don't exist you obviously have no rights

    for (const rightEntry of chain) {
      if (!rightEntry.databaseId || (rightEntry.target && !rightsTable))
        continue; //we never found the righttable, so skip this right chec

      let grantQuery = db<RightsDB>().selectFrom(rightEntry.target ? rightsTable! : "system_rights.global_rights").where("right", "=", rightEntry.databaseId).where("grantee", "in", expanded);
      if (object !== "any") ///we desire a grant for either the object, one of its parents, or just null to match all
        grantQuery = grantQuery.where(eb => eb.or([eb("object", "in", matchObjects), eb("object", "is", null)]));

      if (await grantQuery.select("id").executeTakeFirst())
        return true;
    }
    return false;
  }

  async hasRight(right: GlobalRight): Promise<boolean> {
    return await this.executeHasRight(right, "global", "any");
  }

  async hasRightOn(right: TargettedRight, object: number | "all" | "any"): Promise<boolean> {
    if (object === 0)
      throw new Error("Cannot check rights on object 0 - pass 'null' instead"); //safety check - it's a foreign key in WHDB so we expect 0 to be invalid

    return await this.executeHasRight(right, "target", object);
  }

  async filterRightOn(right: TargettedRight, objectIds: number[]): Promise<number[]> {
    const out: number[] = [];
    // TODO: Optimize this is a naive implementation just to run/pass tests. HS did it
    for (const objectId of [...new Set(objectIds)])
      if (await this.executeHasRight(right, "target", objectId))
        out.push(objectId);
    return [...new Set(out)].toSorted((lhs, rhs) => lhs - rhs);
  }

  async getRootObjects(rights: TargettedRight[]): Promise<number[] | "all"> {
    const { chain, target, rightsTable, parentColumn, targetTable } = await describeChain(rights[0]);

    if (!chain[0].target)
      throw new Error(`Right '${chain[0].name}' is a global right, use hasRight instead`);

    const globalrights = new Set<number>(chain.filter(c => !c.target && c.databaseId).map(c => c.databaseId!) as number[]);
    const targettedrights = new Set<number>(chain.filter(c => c.target && c.databaseId).map(c => c.databaseId!));

    //If we're looking up more than one right it just extends the number of targettedrights we care about
    if (rights.length > 1) {
      for (const right of rights.slice(1)) { //we'll need to validate them all and get their right id
        const subInfo = await describeChain(right);
        if (subInfo.target !== target)
          throw new Error(`Right '${right}' is not targetted at the same object type as '${chain[0].name}'`);

        //Add their IDs to the sets we'll check
        for (const entry of subInfo.chain)
          if (entry.databaseId)
            if (entry.target)
              targettedrights.add(entry.databaseId);
            else
              globalrights.add(entry.databaseId);
      }
    }

    const expanded = await this.getMyAuthObjects();
    if (!expanded.length)
      return []; //if you don't exist you obviously have no rights

    // Check if you have any of the global rights in the chain. Because if so, you have the rights to 'all' and we won't have to look up individual objects
    if (globalrights.size) {
      const grantQuery = await db<RightsDB>().selectFrom("system_rights.global_rights").where("right", "in", [...globalrights]).where("grantee", "in", expanded).limit(1).select("id").executeTakeFirst();
      if (grantQuery)
        return "all";
    }

    if (!rightsTable)
      return []; //no object rights table installed yet, so only implicit rights could get you access. done!

    //Gather the granted objects
    if (!targettedrights.size)
      return []; // none of the requested rights are installed in the db, so no access

    const grantedObjects = await db<RightsDB>().selectFrom(rightsTable).where("right", "in", [...targettedrights]).where("grantee", "in", expanded).select("object").distinct().execute();
    if (grantedObjects.some(r => r.object === null))
      return "all";

    const rootObjects = new Set([...grantedObjects.map(r => r.object)]);
    if (targetTable && parentColumn) { //eliminate child objects
      for (const obj of [...rootObjects]) {
        for (const parent of await gatherParents(targetTable, parentColumn, obj))
          if (parent !== obj && rootObjects.has(parent))
            rootObjects.delete(obj); //if the parent is also in the list, we don't need to return this object
      }
    }

    return [...rootObjects];
  }
}

export async function ensureAuthObject(auth: AuthorizationInterface): Promise<number> {
  const authObj = await ((auth as WRDEntityAuthorization)["getPrimaryAuthObject"](true));
  return authObj.id;
}

/** Create the authorization interface for a given user entity to check/modify rights and roles
 * @param entityId - The ID of the user entity to create the interface for
*/
export function getAuthorizationInterface(entityId: number): AuthorizationInterface {
  return new WRDEntityAuthorization(entityId, undefined);
}

export function __getAuthorizationInterfaceForUser(authObjectId: number) {
  return new WRDEntityAuthorization(undefined, { id: authObjectId, type: authobjectTypeUser });
}

/** Gather information about users based on the current WRD Schema */
export async function getAuthorizationUsers(wrdSchema: WRDSchemaType<AnySchemaType>, auths: AuthorizationInterface[]): Promise<Map<AuthorizationInterface, number>> {
  const authSettings = await getAuthSettings(wrdSchema);
  if (!authSettings)
    throw new Error(`WRD Schema ${wrdSchema.getId()} does not have authentication settings, cannot get user information`);

  //TODO a lot can be optimized here, especially by doing database calls in bulk
  const result = new Map<AuthorizationInterface, number>();

  for (const auth of auths) {
    if (result.get(auth))
      continue; //we've already looked this one up (users passing list() output to us easily trigger this)

    const authobjectid = (await (auth as WRDEntityAuthorization)["getPrimaryAuthObject"](false))?.id;
    if (!authobjectid)
      continue; //a user without an authobject wasn't stored to the database yet, skip it

    //Map authobject to a userid in the current schema
    const guid = await db<PlatformDB>().selectFrom("system.authobjects").where("id", "=", authobjectid).select("guid").executeTakeFirst();
    if (!guid)
      continue; //shouldn't happen, but if the authobject disappeared from the database for some reason, skip it

    const entity = await wrdSchema.find(authSettings.accountType, { wrdGuid: wrdGuidToUUID(guid.guid) });
    if (!entity)
      continue; //not present in this schema (anymore)

    result.set(auth, entity);
  }

  return result;
}

export async function getAuthorizationUser(wrdSchema: WRDSchemaType<AnySchemaType>, auth: AuthorizationInterface): Promise<number | undefined> {
  return (await getAuthorizationUsers(wrdSchema, [auth])).get(auth);
}

export type { WRDEntityAuthorization };
