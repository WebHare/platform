import { buildGeneratorContext, updateGeneratedFiles } from '@mod-system/js/internal/generation/generator';
import { GeneratorType } from '@mod-system/js/internal/generation/shared';
import { loadlib } from '@webhare/harescript';
import { beginWork, commitWork } from '@webhare/whdb';
import { backendConfig, lockMutex, logDebug, openBackendService, scheduleTimedTask } from "@webhare/services";

type SubsystemData = {
  title: string;
  description: string;
  generate?: readonly GeneratorType[];
};

const subsystems = {
  assetpacks: { title: "Assetpacks", description: "Update active assetpacks", generate: ["extract"] },
  registry: { title: "Registry", description: "Initialize registry keys defined in module definitions" },
  wrd: { title: "WRD", description: "Apply wrdschema definitions and regenerate the TS definitions", generate: ["wrd"] },
  siteprofiles: { title: "Siteprofiles", description: "Recompile site profiles" },
  siteprofilerefs: { title: "Siteprofile references", description: "Regenerate site webfeature/webdesign associations" },
} as const satisfies Record<string, SubsystemData>;


export type ConfigurableSubsystem = keyof typeof subsystems;
export const configurableSubsystems: Record<ConfigurableSubsystem, SubsystemData> = subsystems;


export interface ApplyConfigurationOptions {
  modules?: string[];
  subsystems: Array<ConfigurableSubsystem | "all">;
  verbose?: boolean;
  force?: boolean;
  source: string;
}

export async function applyConfiguration(options: ApplyConfigurationOptions) {
  using mutex = await lockMutex("platform:setup");
  void (mutex);

  const start = Date.now();
  const todo = (options.subsystems.includes('all') ? Object.keys(configurableSubsystems) : options.subsystems) as ConfigurableSubsystem[];
  const verbose = Boolean(options.verbose);
  logDebug("platform:configuration", { type: "apply", modules: options.modules, subsystems: todo, source: options.source });
  try {
    //Which config files to update
    const togenerate = new Set<GeneratorType>(["config"]);
    for (const [subsystem, settings] of Object.entries(configurableSubsystems))
      if (settings.generate && (todo.includes(subsystem as ConfigurableSubsystem)))
        settings.generate.forEach(_ => togenerate.add(_));

    const generateContext = await buildGeneratorContext(null, verbose || false);
    await updateGeneratedFiles([...togenerate], { verbose: verbose, nodb: false, dryRun: false, generateContext });

    if (todo.includes('assetpacks')) {
      const assetpackcontroller = await openBackendService("platform:assetpacks", ["apply assetpacks"]);
      await assetpackcontroller.reload();
    }

    if (todo.includes('registry')) {
      /* Initialize missing registry keys. This should be done before eg. WRD so that wrd upgrade scripts can read the registry

         We could port this to JS... but then we'd have to process XML too *and* HS would have to be updated to process YML keys too (to match expectations)
         And we can't drop the HS part yet as it's very early in DB init/bootstrap.. until we do that part of the bootstrap too
         So just use the HS implementation for now and we'll see when we get around to YML registry keys */
      await loadlib("mod::system/lib/internal/modules/moduleregistry.whlib").InitModuleRegistryKeys(options.modules || Object.keys(backendConfig.module));
    }

    if (todo.includes('wrd')) {
      //Update WRD schemas (TODO limit ourselves based on module mask)
      if (options.verbose)
        console.log("Updating WRD schemas based on their schema definitions");
      const applyupdates = loadlib("mod::wrd/lib/internal/metadata/applyupdates.whlib");
      const schemamasks = options?.modules ? options?.modules.map(_ => `${_}:*`) : [];
      if (!await applyupdates.UpdateAllModuleSchemas({ schemamasks, reportupdates: true, reportskips: verbose, force: options.force }))
        process.exitCode = 1;

      await beginWork();
      await scheduleTimedTask("wrd:scanforissues");
      await commitWork();

      await updateGeneratedFiles(["wrd"], { verbose, nodb: false, dryRun: false, generateContext });
    }

    if (todo.includes('siteprofiles')) {
      await loadlib("mod::publisher/lib/internal/siteprofiles/compiler.whlib").__DoRecompileSiteprofiles(true, false, true);
    } else if (todo.includes('siteprofilerefs')) {
      await loadlib("mod::publisher/lib/internal/siteprofiles/reader.whlib").UpdateSiteProfileRefs(null);
    }

    logDebug("platform:configuration", { type: "done", at: Date.now() - start });
  } catch (e) {
    logDebug("platform:configuration", { type: "error", at: Date.now() - start, message: (e as Error)?.message ?? "", stack: (e as Error)?.stack ?? "" });
    throw e;
  }
}
