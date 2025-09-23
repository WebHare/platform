import { runJSBasedValidator, type ValidationMessageWithType } from "@mod-platform/js/devsupport/validation";
import { type HSVMObject, loadlib } from "@webhare/harescript";
import { WebHareBlob, backendConfig } from "@webhare/services";
import { parseModuleDefYMLText, type ModDefYML } from "@webhare/services/src/moduledefparser";
import { omit } from "@webhare/std";
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
  await test.wait(() => Boolean(backendConfig.module[name]));

  console.log(`installed ${name} to ${(res as { path: string }).path}`);
  return res;
}

export async function checkModule(name: string): Promise<ValidationMessageWithType[]> {
  const res = await loadlib("mod::system/lib/internal/modules/checkmodule.whlib").CheckModule(name) as
    Array<{
      resourcename: string;
      line: number;
      col: number;
      message: string;
      category: 'error' | 'warning' | 'hint';
    }>;
  return res.map(_ => ({
    ...omit(_, ["category"]),
    type: _.category,
    source: "checkmodule" //FIXME shouldn't (some) errors have sources?
  }));
  /*
    modname, CELL
    [ printissues := TRUE
    , args.debug
    , args.onlytids
    , args.filemask
    , args.color
    , args.nowarnings
    , checktypescript := checktypescript AND NOT args.nochecktypescript
    , args.hidehints
    , documentation := args.doc
    , onlypaths
    ]);
*/
}


//TODO does this need to be a testapi? or something for a @webhare/config ?
export async function deleteTestModule(name: string) {
  await loadlib("mod::system/lib/internal/moduleimexport.whlib").DeleteModule(name);
}

export async function parseAndValidateModuleDefYMLText(yaml: string, { module = "webhare_testsuite" } = {}): Promise<ModDefYML> {
  const validationresult = await runJSBasedValidator(WebHareBlob.from(yaml), `mod::${module}/moduledefinition.yml`);
  test.eq([], validationresult.messages);
  return parseModuleDefYMLText(module, yaml);
}
