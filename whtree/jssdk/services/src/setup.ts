import { updateGeneratedFiles } from '@mod-system/js/internal/generation/generator';
import { loadlib } from '@webhare/harescript/src/contextvm';
import { scheduleTimedTask } from '@webhare/services/src/tasks';
import { beginWork, commitWork } from '@webhare/whdb';
import { logDebug } from "@webhare/services/src/logging";
import { lockMutex } from "./mutex";

export const ConfigurableSubsystems = {
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

  subsystems = Object.keys(ConfigurableSubsystems) as ConfigurableSubsystem[];

  const start = Date.now();
  logDebug("platform:configuration", { type: "apply", modules, subsystems, source });
  try {
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

      await updateGeneratedFiles(["wrd"], { verbose, nodb: false, dryRun: false });
    }

    logDebug("platform:configuration", { type: "done", at: Date.now() - start });
  } catch (e) {
    logDebug("platform:configuration", { type: "error", at: Date.now() - start, message: (e as Error)?.message ?? "", stack: (e as Error)?.stack ?? "" });
    throw e;
  }
}
