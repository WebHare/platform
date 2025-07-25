import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { getTid } from "@webhare/gettid";
import { throwError } from "@webhare/std";
import { db } from "@webhare/whdb";
import { selectFSFullPath, selectFSLink } from "@webhare/whdb/src/functions";
import { PublishedFlag_Warning, getPrioOrErrorFromPublished, getWHFSDescendantIds, testFlagFromPublished } from "@webhare/whfs/src/support";

async function listSiteIssues() {
  const sites = await db<PlatformDB>()
    .selectFrom("system.sites")
    .selectAll()
    .execute();

  const siteids = sites.filter(site => !site.locked && site.outputweb).map(site => site.id);
  const sitefiles = [];
  for (const siteid of siteids) {
    const allparents: number[] = [siteid, ...await getWHFSDescendantIds([siteid], true, false)];
    const brokenfiles: number[] = (await db<PlatformDB>()
      .selectFrom("system.fs_objects")
      .select(["id", "published"])
      .where("parent", "in", allparents)
      .execute()).filter(file => file.published % 100000 > 100).map(file => file.id);

    //FIXME too low level , rewrite to list call
    const mysitefiles = (await db<PlatformDB>()
      .selectFrom("system.fs_objects")
      .select(["id", "title", "name", "errordata", "published"])
      .select(selectFSLink().as("url"))
      .select(selectFSFullPath().as("fullpath"))
      .where("id", "in", brokenfiles)
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

void main();
