import { HSVMObject, loadlib } from "@webhare/harescript";
import { WebHareBlob, backendConfig } from "@webhare/services";
import * as test from "@webhare/test";

export async function installTestModule(name: string, files: Record<string, string>) {
  const archive = await loadlib("mod::system/whlibs/filetypes/archiving.whlib").CreateNewArchive("application/zip") as HSVMObject;
  for (const [path, data] of Object.entries(files)) {
    await archive.AddFile(name + "/" + path, WebHareBlob.from(data), new Date);
  }
  const modulearchive = await archive.MakeBlob();
  const res = await loadlib("mod::system/lib/internal/moduleimexport.whlib").ImportModule(modulearchive) as {
    name: string;
    path: string;
    fullversion: string;
    warnings: string[];
    errors: string[];
    importmodulename: string;
    manifestdata: unknown;
    orgmanifestdata: unknown;
  };

  // Wait for the module to show up in the local configuration
  test.wait(() => Boolean(backendConfig.module[name]));

  console.log(`installed ${name} to ${(res as { path: string }).path}`);
  return res;
}
