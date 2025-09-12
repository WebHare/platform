import * as kysely from "kysely";
import { db, isWorkOpen, runInWork, uploadBlob } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { } from "@mod-platform/generated/ts/whfstypes.ts";
import { __openWHFSObj } from "./objects";
import { getWHFSDescendantIds, isReadonlyWHFSSpace } from "./support";
import { getData, setData, type EncodedFSSetting, type MemberType } from "./codecs";
import { addMissingScanData, decodeScanData, getUnifiedCC, ResourceDescriptor, type ExportOptions } from "@webhare/services/src/descriptor";
import { appendToArray, compareProperties, convertWaitPeriodToDate, nameToCamelCase, omit, throwError, type WaitPeriod } from "@webhare/std";
import { SettingsStorer } from "@webhare/wrd/src/entitysettings";
import { describeWHFSType, type FSSettingsRow } from "./describe";
import type { WebHareBlob } from "@webhare/services";

// @ts-ignore -- this file is only accessible when this is file loaded from a module (not from the platform tsconfig)
import type { } from "wh:ts/whfstypes.ts";
import { CSPMemberType } from "./siteprofiles";

// We keep this internal, we might want cq like to restructure this API in the future
export interface WHFSTypes {
}

export type WHFSMetaType = "fileType" | "folderType" | "widgetType";

export type WHFSInstanceData = {
  whfsType: keyof WHFSTypes | string;
  [key: string]: unknown;
};

export type TypedWHFSInstanceData = { [K in keyof WHFSTypes]: kysely.Simplify<{ whfsType: K } & WHFSTypes[K]["GetFormat"]> }[keyof WHFSTypes];
export type TypedWHFSInstanceExportData = { [K in keyof WHFSTypes]: kysely.Simplify<{ whfsType: K } & WHFSTypes[K]["ExportFormat"]> }[keyof WHFSTypes];
export type TypedWHFSInstanceSetData = { [K in keyof WHFSTypes]: kysely.Simplify<{ whfsType: K } & WHFSTypes[K]["SetFormat"]> }[keyof WHFSTypes];

type NumberOrNullKeys<O extends object> = keyof { [K in keyof O as O[K] extends number | null ? K : never]: null } & string;

export interface WHFSTypeMember {
  id: number;
  name: string;
  type: MemberType;
  //children. only if type === array
  children?: WHFSTypeMember[];
}

/** Properties implemented by all WHFS Types */
export interface WHFSTypeBaseInfo {
  id: number | null;
  title?: string;
  namespace: string;
  members: WHFSTypeMember[];
}

/** The interface used for WHFS Types that only contain fields but don't explicitly implement a file, folder or widget type */
export interface FieldsTypeInfo extends WHFSTypeBaseInfo {
  metaType?: never;
}

//TODO mark inwebdesign etc as present..
export interface FileTypeInfo extends WHFSTypeBaseInfo {
  metaType: "fileType";

  /** When rendered, render inside a webdesign (formerly 'needstemplate') */
  isWebPage: boolean;
  /** Is this a directly downloadable type? (does its "data" member make sense, formerly 'blobiscontent') */
  hasData: boolean;
}

export interface WidgetTypeInfo extends WHFSTypeBaseInfo {
  metaType: "widgetType";
}

export interface FolderTypeInfo extends WHFSTypeBaseInfo {
  metaType: "folderType";
}

/** A type representing all possible WHFS Type interfaces */
export type WHFSTypeInfo = FieldsTypeInfo | FileTypeInfo | FolderTypeInfo | WidgetTypeInfo;

interface InstanceSetOptions {
  ///How to handle readonly fsobjects. fail (the default), skip or actually update
  ifReadOnly?: "fail" | "skip" | "update";
}

class RecursiveSetter {
  linkchecked_settingids: number[] = [];
  toinsert: EncodedFSSetting[] = [];
  //The complete list of settings being updated
  cursettings;

  constructor(cursettings: readonly FSSettingsRow[]) {
    this.cursettings = cursettings;
  }

  async apply(instanceId: number) {
    const storer = new SettingsStorer(this.toinsert);

    //TODO learn/share more with WRD about matching/reusing settings
    const reusedSettings = new Set(storer.reuseExistingSettings("parent", "fs_member", this.cursettings));
    await storer.allocateIdsAndParents(storer.flattened, "system.fs_settings.id");

    //Kysely's InsertQueryBuilder builds a huge parametered insert statement, but there's a 32767 variable limit in PG. We're updating 8 fields, plus 1 for ID, but let's just keep it a approx 4K vars which is about 400 records per insert block
    const updateBlockSize = 400;
    for (let pos = 0; pos < storer.flattened.length; pos += updateBlockSize) {
      await db<PlatformDB>()
        .insertInto("system.fs_settings")
        .values(storer.flattened.slice(pos, pos + updateBlockSize).map(row => ({
          ordering: 0,
          ...omit(row, ["sub", "parentsetting"]),
          setting: row.setting || '',
          parent: row.parentsetting,
          fs_instance: instanceId
        })))
        .onConflict((oc) => oc
          .column("id")
          .doUpdateSet({
            setting: kysely.sql`excluded.setting`,
            fs_object: kysely.sql`excluded.fs_object`,
            instancetype: kysely.sql`excluded.instancetype`,
            blobdata: kysely.sql`excluded.blobdata`,
            ordering: kysely.sql`excluded.ordering`,
            parent: kysely.sql`excluded.parent`,
          })
        )
        .execute();
    }

    //Basically we discard all settingIds we didn't reuse
    const todiscard = this.cursettings.filter(row => !reusedSettings.has(row.id)).map(row => row.id);
    if (todiscard.length)
      await db<PlatformDB>().deleteFrom("system.fs_settings").where("id", "in", todiscard).execute();
  }
}

/** An API offering access to data stored in an instance type.
 */
class WHFSTypeAccessor<GetFormat extends object, SetFormat extends object, ExportFormat extends object> {
  private readonly ns: string;

  constructor(ns: string) {
    this.ns = ns;
  }

  private async getCurrentInstanceId(fsobj: number, type: WHFSTypeBaseInfo) {
    return (await db<PlatformDB>()
      .selectFrom("system.fs_instances").select("id").where("fs_type", "=", type.id).where("fs_object", "=", fsobj).executeTakeFirst())?.id || null;
  }
  private async getCurrentSettings(instanceIds: readonly number[], descr: WHFSTypeBaseInfo, keysToSet?: readonly string[]) {
    const dbsettings: FSSettingsRow[] = [];
    let query = db<PlatformDB>()
      .selectFrom("system.fs_settings")
      .selectAll()
      .where("fs_instance", "in", instanceIds);

    if (keysToSet) {
      const memberIds = descr.members.filter(_ => keysToSet.includes(_.name)).map(_ => _.id);
      query = query.where(qb => qb("fs_member", "in", memberIds));
    } else
      query = query.where(qb => qb("parent", "is", null));

    let worklist = await query.execute();

    appendToArray(dbsettings, worklist);
    const seenids = new Set(worklist.map(_ => _.id));

    while (worklist.length) { //recurse to get more settings by parent. just filtering by all toplevel memberids recursively isn't enough to catch instances as they can be any member id
      const childQuery = await db<PlatformDB>()
        .selectFrom("system.fs_settings")
        .selectAll()
        .where("fs_instance", "in", instanceIds)
        .where("parent", "in", worklist.map(_ => _.id))
        .execute();

      appendToArray(dbsettings, childQuery);
      worklist = childQuery.filter(_ => !seenids.has(_.id)); //prevent loops
      for (const row of worklist)
        seenids.add(row.id);
    }

    //Get the toplevel member ids we will be replacing (we always fully replace a toplevel member))
    return dbsettings.sort((a, b) => (a.parent || 0) - (b.parent || 0) || a.fs_member - b.fs_member || a.ordering - b.ordering);
  }

  private async getBulk(fsObjIds: number[], properties: string[] | null, options?: ExportOptions): Promise<Map<number, unknown>> {
    const descr = await describeWHFSType(this.ns);
    const instanceIdMapping = await db<PlatformDB>()
      .selectFrom("system.fs_instances")
      .innerJoin("system.fs_objects", "system.fs_objects.id", "system.fs_instances.fs_object")
      .select(["system.fs_instances.id", "fs_object", "system.fs_objects.creationdate"])
      .where("fs_type", "=", descr.id)
      .where("fs_object", "in", fsObjIds)
      .execute();
    const instanceIds = instanceIdMapping.map(_ => _.id);
    const instanceInfo = new Map(instanceIdMapping.map(_ => [_.fs_object, _]));
    const cursettings = instanceIds.length ? await this.getCurrentSettings(instanceIds, descr, properties || undefined) : [];
    const groupedSettings = Map.groupBy(cursettings, _ => _.fs_instance);
    const getMembers = properties ? descr.members.filter(_ => properties.includes(_.name as string)) : descr.members;

    const retval = new Map<number, unknown>();
    for (const id of fsObjIds) {
      const mapping = instanceInfo.get(id);
      const cc = mapping ? getUnifiedCC(mapping.creationdate) : 0;
      const settings = groupedSettings.get(mapping?.id || 0) || [];
      const decoderContext = {
        allsettings: settings,
        cc,
        ...options
      };
      //TODO if settings is empty, we could straight away take or reuse the defaultinstance
      const result = await getData(getMembers, null, decoderContext);
      retval.set(id, result);
    }

    return retval;
  }

  async get(id: number, options: ExportOptions & { export: true }): Promise<ExportFormat>;
  async get(id: number, options?: ExportOptions): Promise<GetFormat>;

  async get(id: number, options?: ExportOptions): Promise<GetFormat | ExportFormat> {
    const bulkdata = await this.getBulk([id], null, options);
    return bulkdata.get(id) as GetFormat | ExportFormat;
  }

  async enrich<
    DataRow extends { [K in EnrichKey]: number | null },
    EnrichKey extends keyof DataRow & NumberOrNullKeys<DataRow>,
    AddKey extends keyof GetFormat = never>(data: DataRow[], field: EnrichKey, properties: AddKey[]): Promise<Array<DataRow & Pick<GetFormat, AddKey>>> {

    const fsObjIds: number[] = data.map(_ => _[field] as number);
    const bulkdata = await this.getBulk(fsObjIds, properties as string[]);

    const results: Array<DataRow & Pick<GetFormat, AddKey>> = [];
    for (const row of data) //@ts-ignore should be able to assume it works. besides we'll rewrite this API anyway to actually be efficient
      results.push({ ...row, ...bulkdata.get(row[field]) });

    return results;
  }

  async set(id: number, data: SetFormat, options?: InstanceSetOptions): Promise<void> {
    const descr = await describeWHFSType(this.ns);
    if (!descr.id)
      throw new Error(`You cannot set instances of type '${this.ns}'`);
    const objinfo = await __openWHFSObj(0, id, undefined, false, "setInstanceData", false, false); //TODO should we derive InstanceSetOptions from OpenWHFSObjectOptions ? but how does that work with readonly skip/fail/update ?
    if (options?.ifReadOnly !== 'update' && isReadonlyWHFSSpace(objinfo?.whfsPath)) {
      if (options?.ifReadOnly !== 'skip') //ie "fail"
        throw new Error(`Attempting to update instance data on non existing file #${id} `);
      return;
    }

    let instanceId = await this.getCurrentInstanceId(id, descr);

    //TODO bulk insert once we've prepared all settings
    const keysToSet = Object.keys(data);
    const cursettings = instanceId && keysToSet.length ? await this.getCurrentSettings([instanceId], descr, keysToSet) : [];

    const setter = new RecursiveSetter(cursettings);
    appendToArray(setter.toinsert, await setData(descr.members, data));

    if (!instanceId) //FIXME *only* get an instanceId if we're actually going to store settings
      instanceId = (await db<PlatformDB>().insertInto("system.fs_instances").values({ fs_type: descr.id, fs_object: id }).returning("id").executeTakeFirstOrThrow()).id;

    await setter.apply(instanceId);

    // if (!(await result).any_nondefault) {
    /* We may be able to delete the instance completely. Check if settings still remain, there may be
       members RecurseSetInstanceData didn't know about */
    // IF(NOT RecordExists(SELECT FROM system.fs_settings WHERE fs_instance = instance LIMIT 1))
    // {
    //   DELETE FROM system.fs_instances WHERE id = instance;
    //   instance:= 0;
    // }
    // } else {
    //FIXME      GetWHFSCommitHandler()->AddLinkCheckedSettings(rec.linkchecked_settingids);
    // }
    /* FIXME
        IF(this->namespace = "http://www.webhare.net/xmlns/publisher/sitesettings") //this might change siteprofile associations or webdesign/webfeatures
          GetWHFSCommitHandler()->TriggerSiteSettingsCheckOnCommit();

        IF (options.isvisibleedit)
          GetWHFSCommitHandler()->TriggerEmptyUpdateOnCommit(objectid);
        ELSE
          GetWHFSCommitHandler()->TriggerReindexOnCommit(objectid);
    */
  }
}

export interface VisitedResourceContext {
  fsObject: number;
  fieldType: MemberType & ("file" | "richTextDocument" | "composedDocument");
  fieldName: string;
  fsType: string;
}

export type VisitCallback = (ctx: VisitedResourceContext, resource: ResourceDescriptor) => Promise<ResourceDescriptor | void> | ResourceDescriptor | void;

/** Update image resources in WHFS Type settings (both files and inside rich documents)
 * @param callback - Callback to call for each resource optionally returning a ResourceDescriptor to update the resource with
 * @returns A continuation token which can be passed into 'nextToken' to resume processing. An empty string if we're done
*/
export async function visitResources(callback: VisitCallback, scope: {
  startingPoints: number[];
  nextToken?: string;
  batchSize?: number;
  deadline?: WaitPeriod;
  isVisibleEdit?: boolean;
}): Promise<string> {
  if (isWorkOpen())
    throw new Error("visitResources should not be called inside a transaction");

  // Expand starting points to all folders, sorted.
  const allfolderids = [...scope.startingPoints, ...await getWHFSDescendantIds(scope.startingPoints, true, false)];
  const deadline = scope.deadline ? convertWaitPeriodToDate(scope.deadline) : undefined;

  //We loop once with folder '0' where we take the startingPoints *themselves* (id IN startingPoints) and then we work our way down the parents (parent IN ...)
  const allQueries: Array<{ condition: "in" | "parent"; value: number }> = [
    ...scope.startingPoints.map(startingPoint => ({ condition: "in" as const, value: startingPoint })),
    ...allfolderids.map(folderId => ({ condition: "parent" as const, value: folderId }))
  ].toSorted(compareProperties(["value", "condition"]));

  // TODO: Sorting by creationdates instead of IDs should be more robust against deletions between iterations, if we also store dates in nexttoken ?
  let batchSize = scope.batchSize ?? Number.MAX_SAFE_INTEGER;
  let queryPos = 0, resultPos = 0;

  if (scope.nextToken) {
    const parsedNextToken = scope.nextToken.match(/^instance:(\d+):(\d+)$/);
    if (parsedNextToken) {
      queryPos = parseInt(parsedNextToken[1], 10);
      resultPos = parseInt(parsedNextToken[2], 10);
    }
  }

  for (; queryPos < allQueries.length; ++queryPos) {
    const query = allQueries[queryPos];
    const queryBuilder = db<PlatformDB>().
      selectFrom("system.fs_settings").
      innerJoin("system.fs_members", "system.fs_members.id", "system.fs_settings.fs_member").
      where("system.fs_members.type", "in", [5, 15, 20]). //5=file, 15=richdoc, 20=composeddoc - TODO don't hardcode constant, add RTD and 'image' type
      where("system.fs_settings.blobdata", "is not", null).
      innerJoin("system.fs_instances", "system.fs_settings.fs_instance", "system.fs_instances.id").
      select(["system.fs_settings.id", "system.fs_settings.setting", "system.fs_settings.blobdata", "system.fs_instances.fs_object", "system.fs_members.type", "system.fs_members.name", "system.fs_members.fs_type"]).
      orderBy("system.fs_settings.id");

    let results: Array<{ id: number; setting: string; blobdata: WebHareBlob | null; type: number; fs_object: number; fs_type: number; name: string }> = [];
    if (query.condition === "in")
      results = await queryBuilder.where("system.fs_instances.fs_object", "=", query.value).execute();
    else
      results = await queryBuilder.innerJoin("system.fs_objects", "system.fs_objects.id", "system.fs_instances.fs_object").
        where("system.fs_objects.parent", "=", query.value).execute();

    for (; resultPos < results.length; ++resultPos) {
      const result = results[resultPos];

      if (result.setting === "RD1" || result.setting === "FD1" || result.setting.startsWith("CD1:"))
        continue; //richdocument blob. ignore

      if (batchSize-- <= 0 || (deadline && new Date() > deadline))
        return `instance:${queryPos}:${resultPos}`; //there will be something to do, but we reached the batch size, it will be up to the next run

      //As we're not calculating the original 'cc' we can't add a dbLoc. Wouldn't be too difficult to add if really needed
      const reconstructedDescriptor = new ResourceDescriptor(
        result.blobdata,
        decodeScanData(result.setting));

      const typeInfo = await describeWHFSType(result.fs_type, { allowMissing: true });
      if (!typeInfo)
        continue; //ignore orphans

      const update = await callback(
        {
          fsObject: result.fs_object,
          fsType: typeInfo?.namespace,
          fieldType: result.type === CSPMemberType.File ? "file"
            : result.type === CSPMemberType.RichTextDocument ? "richTextDocument"
              : result.type === CSPMemberType.ComposedDocument ? "composedDocument"
                : throwError(`Unexpected type ${result.type}`), //TODO don't hardcode constant, add RTD and 'image' type
          fieldName: nameToCamelCase(result.name) //FIXME take full path and member name from type info
        }, reconstructedDescriptor);

      if (update) {
        if (scope?.isVisibleEdit !== false) //for now we'll require setting this flag until we can actually update modificationdates ... and then we should just set it to true
          throw new Error("Updating resources requires setting isVisibleEdit to false");

        //TODO check against parallel modification, if so retry or skip
        await runInWork(async () => {
          // When updating embedded content the filename holds the cid so we shouldn't change it
          const fileName = (result.type === 15 || result.type === 20 ? reconstructedDescriptor.fileName : update.fileName) ?? undefined;
          await db<PlatformDB>().updateTable("system.fs_settings").
            set({ blobdata: await uploadBlob(update.resource), setting: await addMissingScanData(update, { fileName }) }).
            where("id", "=", result.id).
            executeTakeFirstOrThrow();
        });
      }
    }

    resultPos = 0; //clear for the next query we will process
  }

  return ''; //done!
}

export function whfsType<WHFSTypeName extends keyof WHFSTypes>(ns: WHFSTypeName): WHFSTypeAccessor<WHFSTypes[WHFSTypeName]["GetFormat"], WHFSTypes[WHFSTypeName]["SetFormat"], WHFSTypes[WHFSTypeName]["ExportFormat"]>;
export function whfsType(ns: string): WHFSTypeAccessor<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
export function whfsType(ns: string): WHFSTypeAccessor<object, object, object> {
  //note that as we're sync, we can't actually promise to validate whether the type exists
  return new WHFSTypeAccessor(ns);
}


/** @deprecated With WH5.9+ just use whfsType() as this call isn't really opening anything until a method is called */
export function openType<WHFSTypeName extends keyof WHFSTypes>(ns: WHFSTypeName): WHFSTypeAccessor<WHFSTypes[WHFSTypeName]["GetFormat"], WHFSTypes[WHFSTypeName]["SetFormat"], WHFSTypes[WHFSTypeName]["ExportFormat"]>;

//We need to preserve the 'explicitly indicated type' form as existing apps might rely on it
/** @deprecated With WH5.9+ just use whfsType() as this call isn't really opening anything until a method is called */
export function openType<GetFormat extends object = Record<string, unknown>>(ns: string): WHFSTypeAccessor<GetFormat, GetFormat, GetFormat>;

export function openType(ns: string): WHFSTypeAccessor<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> {
  //note that as we're sync, we can't actually promise to validate whether the type xists
  return new WHFSTypeAccessor(ns);
}

/** The result of a .get() operation */
export type WHFSTypeGetResult<type extends keyof WHFSTypes> = WHFSTypes[type]["GetFormat"];
