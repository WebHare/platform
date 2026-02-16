import { loadlib } from "@webhare/harescript";
import { backendConfig } from "@webhare/services";
import { isValidModuleName } from "@webhare/services/src/naming";
import { listDirectory, storeDiskFile } from "@webhare/system-tools";
import { isValidName } from "@webhare/whfs";
import { WittyEncodingStyle, WittyTemplate, type WittyData } from "@webhare/witty";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { simpleGit } from "simple-git";

async function instantiateTemplateFolder(sourcefolder: string, destfolder: string, data: WittyData) {
  for (const path of await listDirectory(sourcefolder)) {
    if ([".DS_STORE"].includes(path.name.toUpperCase()))
      continue;

    const srcpath = path.fullPath;
    let destpath = '';
    if (path.name.includes('[')) { //looks like it's witty
      const inwitty = new WittyTemplate(path.name);
      destpath = destfolder + await inwitty.run(data);
    } else {
      destpath = destfolder + path.name;
    }

    if (path.type === "directory") {
      mkdirSync(destpath, { recursive: true });
      await instantiateTemplateFolder(srcpath, destpath + "/", data);
      continue;
    }

    let output = readFileSync(srcpath, 'utf8');

    if (path.name.endsWith("@.witty")) {
      destpath = destpath.slice(0, -7); //strip the extension
      const indata = new WittyTemplate(output, { encoding: destpath.endsWith(".xml") ? WittyEncodingStyle.XML : WittyEncodingStyle.Text });
      output = await indata.run(data);
    }
    await storeDiskFile(destpath, output, { overwrite: true });
  }
}

export async function createModule(subpath: string, modulename: string, options:
  {
    initGit: boolean;
    defaultLanguage: string;
    description?: string;
    afterModuleCreation?: (options: { moduleroot: string }) => void;
  }
) {
  if (subpath && (!isValidName(subpath) || subpath.toLowerCase() !== subpath))
    throw new Error(`Illegal subpath '${subpath}'`);
  if (!isValidName(modulename) || !isValidModuleName(modulename))
    throw new Error(`Illegal module name '${modulename}'`);
  if (backendConfig.module[modulename])
    throw new Error(`A module named '${modulename}' already exists`);

  const creationdate = new Date();
  const destpath = backendConfig.dataRoot + "installedmodules/" + (subpath ? subpath + "/" : "") + modulename;
  if (statSync(destpath, { throwIfNoEntry: false })) {
    const content = (await listDirectory(destpath)).filter(_ => ![".git", ".ds_store"].includes(_.name.toLowerCase()));
    if (content.length > 0) //we don't mind an empty just-initialized git repository
      throw new Error(`The directory '${destpath}' already exists`);
  }

  const retval = { //TODO camelify ? but may be witty incompatible until we decide how witty will deal with camelcase conventions
    modulename,
    destpath: destpath + "/",
    defaultlanguage: options.defaultLanguage,
    description: options.description || '',
    creationdate: creationdate.toISOString().substr(0, 10),
    servername: backendConfig.serverName
  };

  mkdirSync(destpath, { recursive: true });

  if (options.initGit) {
    //RECORD gitresult := ExecuteGitCommand([ 'init', '--initial-branch=main', destpath ]); //2.28.0 supports this... but Ubuntu 20.04 doesn't have that one yet.
    await simpleGit({ baseDir: destpath }).init();
    if ((await simpleGit({ baseDir: destpath }).branch()).all.length === 0)
      await simpleGit({ baseDir: destpath }).checkout(['-b', 'main']);
  }

  await instantiateTemplateFolder(backendConfig.module["devkit"].root + "data/templates/module/", destpath + "/", retval);

  //FIXME don't rely/require dev: for hooks, but also modernize to support WH hooks then
  if (backendConfig.module["dev"])
    await loadlib("mod::system/lib/resources.whlib").RunModuleHookTarget("dev:devtools_modulecreation", { module: modulename, destpath: destpath });

  if (options.afterModuleCreation)
    options.afterModuleCreation({ moduleroot: destpath + "/" });

  await loadlib("mod::system/lib/internal/moduleimexport.whlib").ActivateInstalledModule(modulename, destpath);
  return retval;
}
