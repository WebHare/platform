import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { lookupWHFSObject } from "./database";
import { openFileOrFolder, openFolder } from "./objects";
import { whconstant_whfsid_registerslots } from "@mod-system/js/internal/webhareconstants";
import { broadcastOnCommit, db, runInSeparateWork, sql } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { parseModuleQualifiedName } from "@webhare/services/src/naming";
import { selectFSIsActive, selectFSWHFSPath } from "@webhare/whdb/src/functions";
import { openSite } from "./sites";
import { IntExtLink } from "@webhare/services";

export type StoredWHFSRegisterSlot = {
  name: string;
  title?: string;
  type?: "site" | "file" | "folder";
  description?: string;
  initialValue?: string;
  fallback?: string;
};

type WHFSRegisterSlot = StoredWHFSRegisterSlot & {
  currentValue: number | null;
  currentPath?: string | null;
  isOrphan: boolean;
};

export async function getAllWHFSRegisterSlots(): Promise<WHFSRegisterSlot[]> {
  const slots = getExtractedConfig("whfs").slots;
  const dbSlots = await db<PlatformDB>().
    selectFrom("system.fs_objects as links").
    select(["links.name", "links.filelink", selectFSWHFSPath("targets").as("whfspath")]).
    innerJoin("system.fs_objects as targets", "targets.id", "links.filelink").
    where("links.parent", "=", whconstant_whfsid_registerslots).
    execute();

  const dbSlotsMap = new Map(dbSlots.map(s => [s.name.replace(/--/g, ":").toLowerCase(), ({ ...s, seen: false })]));

  const result: WHFSRegisterSlot[] = [];
  for (const slot of slots) {
    const dbSlot = dbSlotsMap.get(slot.name);
    if (dbSlot)
      dbSlot.seen = true;

    result.push({
      ...slot,
      currentValue: dbSlot?.filelink || null,
      currentPath: dbSlot?.whfspath || null,
      isOrphan: false
    });
  }
  for (const [name, slot] of [...dbSlotsMap.entries()]) {
    if (!slot.seen) {
      result.push({
        name,
        currentValue: slot.filelink,
        currentPath: slot.whfspath,
        isOrphan: true
      });
    }
  }
  return result;
}

function splitSlotName(slot: string) {
  const [module, name] = parseModuleQualifiedName(slot);
  return {
    module,
    name,
    filename: `${module}--${name}`
  };
}

async function ensureSlot(slot: ReturnType<typeof splitSlotName>) {
  const slotFolder = await openFolder(whconstant_whfsid_registerslots, { allowMissing: true });
  if (!slotFolder)
    throw new Error(`WHFS register slots are not yet available (WebHare is still initializing or folder #${whconstant_whfsid_registerslots} has been deleted)`);

  return slotFolder.ensureFile(slot.filename, { type: "platform:filetypes.internallink", publish: false });
}

async function validateTarget(targetid: number, slotInfo: StoredWHFSRegisterSlot) {
  const targetinfo = await openFileOrFolder(targetid); //validates existence and history status
  if (slotInfo.type === "file" && !targetinfo.isFile)
    throw new Error(`The slot '${slotInfo.name}' requires a file, but '${targetinfo.whfsPath}' (fsobject #${targetid}) is a folder`);
  if (slotInfo.type === "site" && !await openSite(targetid, { allowMissing: true }))
    throw new Error(`The slot '${slotInfo.name}' requires a site, but '${targetinfo.whfsPath}' (fsobject #${targetid}) is not a site`);
  if (slotInfo.type === "folder" && !targetinfo.isFolder)
    throw new Error(`The slot '${slotInfo.name}' requires a folder, but '${targetinfo.whfsPath}' (fsobject #${targetid}) is a file`);
}

export async function setWHFSRegisterSlot(slotName: string, value: number | null): Promise<void> {
  const modinfo = getExtractedConfig("whfs").slots.find(s => s.name === slotName);
  if (!modinfo)
    throw new Error(`No such slot '${slotName}' in configuration`);

  const parsedSlot = splitSlotName(slotName);
  if (value)
    await validateTarget(value, modinfo);

  const slot = await ensureSlot(parsedSlot);
  await slot.update({ target: value ? new IntExtLink(value) : null });

  broadcastOnCommit("system:internal.whfsregisterchange", {});
}

async function tryAddWHFSRegister(slot: ReturnType<typeof splitSlotName>, forDeletedFile: number | null): Promise<number | string> {
  const slotName = `${slot.module}:${slot.name}`;
  const modinfo = getExtractedConfig("whfs").slots.find(s => s.name === slotName);
  if (!modinfo)
    throw new Error(`No such slot '${slotName}' in configuration`);

  const slotfile = await ensureSlot(slot);
  if (slotfile.fileLink && slotfile.fileLink !== forDeletedFile) //it appeared in parallel! (not worrying about the race where someone created and IMMEDIATELY recycled it, that's doing it on purpose)
    return slotfile.fileLink;

  let target = modinfo.initialValue ? await lookupWHFSObject(0, modinfo.initialValue) : 0;

  //-1 is not found, 0 is root, both are unacceptable destinations
  if (target <= 0 && modinfo.fallback) {
    target = await lookupWHFSObject(0, modinfo.fallback);
    if (target > 0) //if the fallback is available, return but don't record it. usually a fallback for CI
      return target;
  }

  if (target <= 0) {
    const aboutslot = `WHFS register slot '${slot.module}:${slot.name}' ${forDeletedFile ? `refers to deleted object #${forDeletedFile}` : `has not been set`}`;
    return modinfo.initialValue ? `${aboutslot} and initial value '${modinfo.initialValue}' could not be located` : `${aboutslot} and has no initial value`;
  }

  //Validate and store it
  await validateTarget(target, modinfo);
  await slotfile.update({ target: new IntExtLink(target) });

  broadcastOnCommit("system:internal.whfsregisterchange", {});
  return target;
}

export async function lookupInWHFSRegister(slot: string): Promise<number> {
  const parsedSlot = splitSlotName(slot);
  const lookup = await db<PlatformDB>()
    .selectFrom("system.fs_objects as target")
    .innerJoin("system.fs_objects as linkedobject", "linkedobject.filelink", "target.id")
    .where("linkedobject.parent", "=", whconstant_whfsid_registerslots)
    .where(sql`upper(linkedobject.name)`, "=", sql`upper(${parsedSlot.filename})`)
    .select(["linkedobject.filelink", selectFSIsActive("target").as("isactive")])
    .executeTakeFirst();

  if (!lookup || !lookup.isactive) {
    const result = await runInSeparateWork(() => tryAddWHFSRegister(parsedSlot, lookup?.filelink || null), { mutex: "system:registerslot" });
    if (typeof result === "number")
      return result;
    else
      throw new Error(result); //note that we still commit thet work we've done so far (creating the slot file)
  }
  return lookup.filelink!; //haa to be set, or the innerjoin will fail
}
