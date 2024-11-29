import { ResourceDescriptor } from "@webhare/services";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { openSite, type WHFSFolder } from "@webhare/whfs";
import { beginWork, commitWork } from "@webhare/whdb";

function isBlacklistedName(name: string) {
  return name.startsWith(".");
}

async function uploadReplace(srcdocdir: string, targetdocdir: WHFSFolder) {
  const uploaditems = await readdir(srcdocdir, { withFileTypes: true });
  const currentitems = await targetdocdir.list();

  for (const item of uploaditems) {
    if (isBlacklistedName(item.name))
      continue;

    const fullpath = join(item.path, item.name);
    const existing = currentitems.find(_ => _.name === item.name);
    if (item.isDirectory()) {
      if (existing?.isFolder === false)
        throw new Error(`Cannot replace a file with a folder trying to upload ${fullpath}`);

      const folder = await targetdocdir.ensureFolder(item.name);
      await uploadReplace(srcdocdir + "/" + item.name, folder);
    } else if (item.isFile()) {
      if (existing?.isFolder === true)
        throw new Error(`Cannot replace a folder with a file  trying to upload ${fullpath}`);

      //TOOD leave unchanged files alone
      await targetdocdir.ensureFile(item.name,
        {
          data: await ResourceDescriptor.fromDisk(fullpath),
          type: item.name.endsWith(".html") ? "http://www.webhare.net/xmlns/publisher/htmlfile" : "http://www.webhare.net/xmlns/publisher/plaintextfile",
          publish: true
        });
    }
  }
  //TODO delete unreffed stuff
}

export async function uploadGeneratedDocumentation(docsDir: string) {
  const docsite = await openSite("www.webhare.dev");
  const targetdocdir = await docsite.openFolder("sdk");

  await beginWork();
  await uploadReplace(docsDir, targetdocdir);
  await commitWork();

  console.log(`Updated ${targetdocdir.link}`);
}
