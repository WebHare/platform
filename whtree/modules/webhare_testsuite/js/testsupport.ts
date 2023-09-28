import { beginWork, commitWork } from "@webhare/whdb";
import { openFileOrFolder, openFolder } from "@webhare/whfs";

/// Get the dedicated 'tmp' folder from the webhare_testsuite test site (prepared by webhare_testsuite reset)
export async function getTestSiteTemp() {
  return await openFolder("site::webhare_testsuite.testsite/tmp");
}

export async function testSuiteCleanup() {
  await beginWork();

  const tmpfolder = await openFolder("site::webhare_testsuite.testsite/tmp", { allowMissing: true });
  if (tmpfolder) {
    for (const item of await tmpfolder.list()) {
      //FIXME openObjects would still be very useful
      const obj = await openFileOrFolder(item.id);
      await obj.delete(); //FIXME we desire recyle
    }
  }

  await commitWork();
}
