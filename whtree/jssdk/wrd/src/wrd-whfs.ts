import { whconstant_whfsid_wrdstore } from "@mod-system/js/internal/webhareconstants";
import type { RichTextDocument } from "@webhare/services";
import { nextWHFSObjectId, openFolder, openType, type WHFSFolder } from "@webhare/whfs";
import type { WHFSInstance } from "@webhare/whfs/src/contenttypes";

const cachefolders = new Map<number, WHFSFolder>;

export async function ensureWHFSFolderForWRDSchema(schemaId: number) {
  if (schemaId <= 0)
    throw new Error("Invalid schema id #" + schemaId);

  const match = cachefolders.get(schemaId);
  if (match)
    return match;

  const parent = await openFolder(whconstant_whfsid_wrdstore);
  const folder = await parent.ensureFolder(`S${schemaId}`);
  cachefolders.set(schemaId, folder);
  return folder;
}

//TODO should we support importmapper and then writing to orphans?
export async function storeRTDinWHFS(schemaId: number, rtd: RichTextDocument): Promise<number> {
  //folder, to avoid duplicate insertion/creation
  const schemafolder = await ensureWHFSFolderForWRDSchema(schemaId);
  const fileid = await nextWHFSObjectId();
  const rtdfile = await schemafolder.createFile(fileid.toString(), {
    type: "http://www.webhare.net/xmlns/publisher/richdocumentfile",
    id: fileid
  });
  await openType("http://www.webhare.net/xmlns/publisher/richdocumentfile").set(rtdfile.id, { data: rtd });
  return fileid;
}

export async function getRTDFromWHFS(whfsId: number): Promise<RichTextDocument | null> {
  const result = await openType("http://www.webhare.net/xmlns/publisher/richdocumentfile").get(whfsId);
  return result.data as RichTextDocument | null;
}

export async function getInstanceFromWHFS(whfsId: number): Promise<WHFSInstance> {
  return openType("http://www.webhare.net/xmlns/wrd/instancefile").get(whfsId).then(_ => _.instance as WHFSInstance);
}

export async function storeInstanceInWHFS(schemaId: number, instance: WHFSInstance): Promise<number> {
  //folder, to avoid duplicate insertion/creation
  const schemafolder = await ensureWHFSFolderForWRDSchema(schemaId);
  const fileid = await nextWHFSObjectId();
  await schemafolder.createFile(fileid.toString(), {
    type: "http://www.webhare.net/xmlns/wrd/instancefile",
    id: fileid
  });

  await openType("http://www.webhare.net/xmlns/wrd/instancefile").set(fileid, { instance });
  return fileid;
}
