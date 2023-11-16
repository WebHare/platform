import { buildGeneratorContext, updateGeneratedFiles } from '@mod-system/js/internal/generation/generator';
import { loadlib } from '@webhare/harescript/src/contextvm';
import { scheduleTimedTask } from '@webhare/services/src/tasks';
import { beginWork, commitWork } from '@webhare/whdb';
import { logDebug } from "@webhare/services/src/logging";
import { lockMutex } from "../mutex";
import { backendConfig } from '../config';

export const ConfigurableSubsystems = {
  registry: { title: "Registry", desription: "Initialize registry keys defined in module definitions" },
  wrd: { title: "WRD", description: "Apply wrdschema definitions and regenerate the TS definitions" }
} as const;

export type ConfigurableSubsystem = keyof typeof ConfigurableSubsystems;

export async function applyConfiguration({ modules, subsystems, verbose, source, force }: {
  modules?: string[];
  subsystems?: ConfigurableSubsystem[];
  verbose?: boolean;
  force?: boolean;
  source?: string;
} = {}) {

  using mutex = await lockMutex("platform:setup");
  void (mutex);

  const start = Date.now();
  logDebug("platform:configuration", { type: "apply", modules, subsystems, source });
  try {
    const generateContext = await buildGeneratorContext(null, verbose || false);

    if (subsystems?.includes('registry')) {
      /* Initialize missing registry keys. This should be done before eg. WRD so that wrd upgrade scripts can read the registry

         We could port this to JS... but then we'd have to process XML too *and* HS would have to be updated to process YML keys too (to match expectations)
         And we can't drop the HS part yet as it's very early in DB init/bootstrap.. until we do that part of the bootstrap too
         So just use the HS implementation for now and we'll see when we get around to YML registry keys */
      await loadlib("mod::system/lib/internal/modules/moduleregistry.whlib").InitModuleRegistryKeys(modules || Object.keys(backendConfig.module));
    }

    if (subsystems?.includes('wrd')) {
      //Update WRD schemas (TODO limit ourselves based on module mask)
      if (verbose)
        console.log("Updating WRD schemas based on their schema definitions");
      const applyupdates = loadlib("mod::wrd/lib/internal/metadata/applyupdates.whlib");
      if (!await applyupdates.UpdateAllModuleSchemas({ schemamasks: [], reportupdates: true, reportskips: verbose, force }))
        process.exitCode = 1;

      await beginWork();
      await scheduleTimedTask("wrd:scanforissues");
      await commitWork();

      await updateGeneratedFiles(["wrd"], { verbose, nodb: false, dryRun: false, generateContext });
    }

    logDebug("platform:configuration", { type: "done", at: Date.now() - start });
  } catch (e) {
    logDebug("platform:configuration", { type: "error", at: Date.now() - start, message: (e as Error)?.message ?? "", stack: (e as Error)?.stack ?? "" });
    throw e;
  }
}
