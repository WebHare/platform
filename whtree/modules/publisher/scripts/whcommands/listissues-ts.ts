import type { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { getTid } from "@webhare/gettid";
import { throwError } from "@webhare/std";
import { db, sql } from "@webhare/whdb";
import { PublishedFlag_Warning, getPrioOrErrorFromPublished, testFlagFromPublished } from "@webhare/whfs/src/support";

/** Get all ids from a specific starting point
    @param basefolder - Starting folder
    @param maximumdepth - Maximum depth. Depth=1 only gets the direct subfolders. Suggested
    @param returnfolders - Return folders too */
async function getWHFSDescendantIds(basefolder: number, returnfolders: boolean, returnfiles: boolean, maximumdepth = 32, onlypublished = false) {
  if (!returnfiles && !returnfolders)
    return [];

  const allsubs = [];
  let currentlevel = [basefolder];
  if (maximumdepth > 32)
    maximumdepth = 32; //safety against corrupted databases

  while (maximumdepth >= 1 && currentlevel.length > 0) {
    //If we're not returning files, don't even get them
    const currentsubsSQL = db<PlatformDB>().selectFrom("system.fs_objects").select(["id", "isfolder"])
      .where("parent", "=", sql`any(${currentlevel})`);
    if (!returnfiles)
      currentsubsSQL.where("isfolder", "=", true);
    if (onlypublished)
      currentsubsSQL.where("publish", "=", true);

    const currentsubs = await currentsubsSQL.execute();
    currentlevel = currentsubs.filter(sub => sub.isfolder).map(sub => sub.id);
    allsubs.push(...currentsubs.filter(sub => returnfolders || !sub.isfolder).map(sub => sub.id));
    --maximumdepth;
  }
  return allsubs;
}

async function listSiteIssues() {
  const sites = await db<PlatformDB>()
    .selectFrom("system.sites")
    .selectAll()
    .execute();

  const siteids = sites.filter(site => !site.locked && site.outputweb).map(site => site.id);
  const sitefiles = [];
  for (const siteid of siteids) {
    const allparents: number[] = [siteid, ...await getWHFSDescendantIds(siteid, true, false)];
    const brokenfiles: number[] = (await db<PlatformDB>()
      .selectFrom("system.fs_objects")
      .select(["id", "published"])
      .where("parent", "=", sql`any(${allparents})`)
      .execute()).filter(file => file.published % 100000 > 100).map(file => file.id);

    //FIXME too low level , rewrite to list call
    const mysitefiles = (await db<PlatformDB>()
      .selectFrom("system.fs_objects")
      .select(["id", "title", "name", "errordata", "published"])
      .select(sql<string>`webhare_proc_fs_objects_indexurl(id,name,isfolder,parent,published,type,externallink,filelink,indexdoc)`.as("url"))
      .select(sql<string>`webhare_proc_fs_objects_fullpath(id,isfolder)`.as("fullpath"))
      .where("id", "=", sql`any(${brokenfiles})`)
      .execute()).map(file => ({
        ...file,
        highestparent: siteid,
        status: getPrioOrErrorFromPublished(file.published),
        warning: testFlagFromPublished(file.published, PublishedFlag_Warning)
      }));

    sitefiles.push(...mysitefiles);
  }

  // FIXME: or don't get STRING's and in a later pass get the strings for the files we need them from?
  const rsites = [...Map.groupBy(sitefiles, file => file.highestparent).entries()].map(
    ([highestparent, filerecs]) => {
      const fileswitherrors = filerecs.filter(file => file.status > 100 && file.status !== 112/*site locked*/);
      const site = sites.find(s => s.id === highestparent) ?? throwError("Site not found");

      return {
        id: site.id,
        root: site.id,
        name: site.name,
        published: Boolean(site.outputweb),
        fileswitherrors: fileswitherrors.map(file => ({ ...file, errorcode: file.status }))
      };

    }
  );

  return rsites;
}

function getPublicationErrorMsg(published: number, errordata: string) {
  const errorcode = getPrioOrErrorFromPublished(published);
  switch (errorcode) {
    case 101: return getTid("publisher:publicationstatus.errors.hserror");
    case 102: return getTid("publisher:publicationstatus.errors.abort");
    case 106: return getTid("publisher:publicationstatus.errors.nofirstpage");
    case 108: return getTid("publisher:publicationstatus.errors.noparts");
    case 109: return getTid("publisher:publicationstatus.errors.noprofile");
    case 112: return getTid("publisher:publicationstatus.errors.sitelocked");
    case 115: return getTid("publisher:publicationstatus.errors.conflictingfile", errordata);
    case 2001: return getTid("publisher:publicationstatus.errors.unknowntype");
  }
  if (errorcode >= 1001 && errorcode <= 2000)
    return getTid("publisher:publicationstatus.errors.ioerror");
  if (errorcode >= 2002 && errorcode <= 3000)
    return getTid("publisher:publicationstatus.errors.unsupportedtype", errordata);
  return getTid("publisher:publicationstatus.errors.internalerror", errordata);
}

async function main() {
  const issues = await listSiteIssues();
  for (const sitewithissues of issues.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`Site ${sitewithissues.name}:`);
    for (const file of sitewithissues.fileswitherrors.sort((a, b) => a.fullpath.localeCompare(b.fullpath))) {
      console.log(`- ${file.fullpath}: ${JSON.stringify(getPublicationErrorMsg(file.status, file.errordata))}`);
    }
  }
}

main();
