import { db } from "@webhare/whdb";
import type { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { getExtractedHSConfig } from "@mod-system/js/internal/configuration";
import type { CSPContentType } from "@webhare/whfs/src/siteprofiles";
import { wildcardsToRegExp } from "@webhare/std";

interface ListedFSContentType {
  id: number;
  namespace: string;
  candelete: boolean;
  isfoldertype: boolean;
  orphansince: Date;
  tolliumicon: string;
  type: string;
  codesource: string;
}

/* quick test:
   wh node -e 'require("@mod-platform/js/devsupport/siteprofiles.ts").listFSContentTypes("*").then(x=>console.log(x))'
   */
export async function listFSContentTypes(mask: string): Promise<ListedFSContentType[]> {
  const dbtypes = await db<PlatformDB>().selectFrom("system.fs_types").
    select(["id", "namespace", "orphan", "isfiletype", "isfoldertype", "orphansince", "scopedtype"]).
    execute();

  function getCodeSource(ctype?: CSPContentType) {
    if (!ctype || ['rtdtype', 'contenttype'].includes(ctype.type))
      return '';

    for (const candidate of [
      ctype?.renderer?.objectname,
      ctype?.wittycomponent,
      ctype?.dynamicexecution?.routerfunction,
      ctype?.dynamicexecution?.startmacro,
      ctype?.dynamicexecution?.webpageobjectname,
      ctype?.filetype?.pagelistprovider //it's "a" starting point. unfortunately we don't seem to support bodymacro/renderers at filetype level yet
    ])
      if (candidate)
        return candidate;

    return "";
  }

  const referencedTypesFSObjects = await db<PlatformDB>().selectFrom("system.fs_objects").where("type", 'is not', null).select("type").distinct().execute();
  const referencedTypesFSInstances = await db<PlatformDB>().selectFrom("system.fs_instances").where("fs_type", 'is not', null).select("fs_type").distinct().execute();
  const referencedTypesFSSettings = await db<PlatformDB>().selectFrom("system.fs_settings").where("instancetype", 'is not', null).select("instancetype").distinct().execute();
  const referencedTypeSet = new Set<number>(referencedTypesFSObjects.map(_ => _.type).concat(referencedTypesFSInstances.map(_ => _.fs_type)).concat(referencedTypesFSSettings.map(_ => _.instancetype)) as number[]);

  const result: ListedFSContentType[] = [];
  const extrainfo = getExtractedHSConfig("siteprofiles");
  const ctypemap = new Map<number, CSPContentType>(extrainfo.contenttypes.map((ct: CSPContentType) => [ct.id, ct]));
  for (const type of dbtypes) {
    const match = ctypemap.get(type.id);
    result.push({
      ...type,
      tolliumicon: match?.tolliumicon ?? "",
      type: match?.type ?? (type.isfiletype ? "filetype" : type.isfoldertype ? "foldertype" : "contenttype"),
      codesource: getCodeSource(match),
      candelete: type.orphan && !referencedTypeSet.has(type.id),
    });
  }

  if (!mask)
    return result;

  const regexp = new RegExp(wildcardsToRegExp(mask), 'i');
  return result.filter(_ => `${_.namespace} ${_.codesource}`.match(regexp));
}
