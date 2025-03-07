import { buildGeneratorContext, updateGeneratedFiles } from '@mod-system/js/internal/generation/generator';
import type { GeneratorType } from '@mod-system/js/internal/generation/shared';
import { loadlib } from '@webhare/harescript';
import { beginWork, commitWork } from '@webhare/whdb';
import { backendConfig, lockMutex, logDebug, openBackendService, scheduleTimedTask } from "@webhare/services";
import { updateWebHareConfigFile } from '@mod-system/js/internal/generation/gen_config';

type SubsystemConfig = {
  generate?: readonly GeneratorType[];
};

type SubsystemData = {
  title: string;
  description: string;
  /** Specific update targetting, eg wrd.ts to update just the wh:wrd/ TS files. Should be considered an internal API */
  parts?: Record<string, SubsystemConfig>;
} & SubsystemConfig;


const generateForConfig = ["config", "extract", "wrd", "openapi"] as const;
const generateForDev = ["whdb", "schema", "registry"] as const;

const subsystems = {
  assetpacks: { title: "Assetpacks", description: "Update active assetpacks", generate: ["extract"] },
  /* 'wh apply config' should
      - ensure all code can run after updating a module
        - so it also needs to update any non type-only TS Files  */
  config: {
    title: "Configuration",
    description: "Update configuration files",
    generate: generateForConfig,
    parts: {
      //config.base if you're only here to update eg. the backend URL or module map
      base: { generate: ["config"] },
      extracts: { generate: ["config", "extract"] },
    }
  },
  /* 'wh apply dev' should ensure dev tooling is operable
      - so it probably wants to do everythint 'wh apply config' does
      - it also needs to fix type-only files (whdb, schemas)
  */
  dev: { title: "Development", description: "Update development infrastructure (imports, schemas)", generate: [...generateForConfig, ...generateForDev] },
  registry: { title: "Registry", description: "Initialize registry keys defined in module definitions", generate: ["registry"] },
  wrd: {
    title: "WRD",
    description: "Apply wrdschema definitions and regenerate the TS definitions",
    generate: ["wrd"],
    parts: {
      ts: { generate: ["wrd"] }
    }
  },
  siteprofiles: { title: "Siteprofiles", description: "Recompile site profiles" },
  siteprofilerefs: { title: "Siteprofile references", description: "Regenerate site webfeature/webdesign associations" },
} as const satisfies Record<string, SubsystemData>;


export type ConfigurableSubsystem = keyof typeof subsystems;
export const configurableSubsystems: Record<ConfigurableSubsystem, SubsystemData> = subsystems;
export type ConfigurableSubsystemPart = ConfigurableSubsystem | "all" | `${ConfigurableSubsystem}.${string}`;


export interface ApplyConfigurationOptions {
  modules?: string[];
  /** List of subsytems to re-apply */
  subsystems: ConfigurableSubsystemPart[];
  verbose?: boolean;
  force?: boolean;
  nodb?: boolean;
  source: string;
}

export async function executeApply(options: ApplyConfigurationOptions & { offline?: boolean }) {
  using mutex = options.offline ? null : await lockMutex("platform:setup");
  void (mutex);

  const start = Date.now();
  const verbose = Boolean(options.verbose);
  const togenerate = new Set<GeneratorType>;
  logDebug("platform:configuration", { type: "apply", modules: options.modules, subsystems: options.subsystems, source: options.source });

  const todoList = (options.subsystems.includes('all') ? Object.keys(configurableSubsystems) : options.subsystems) as ConfigurableSubsystem[];
  for (const todoItem of todoList) {
    const [systemName, partName] = todoItem.split('.');
    const system = configurableSubsystems[systemName as ConfigurableSubsystem];
    if (!system)
      continue;

    const def = partName ? system.parts?.[partName] : system;
    if (!def)
      throw new Error(`Invalid subsystem '${todoItem}' targeted. Valid subsystems are: ${Object.keys(configurableSubsystems).join(", ")}`);

    def.generate?.forEach(_ => togenerate.add(_));
  }

  try {
    if (togenerate.has('config')) //regenerating config must be done before buildGeneratorContext or there'll be no module map!
      await updateWebHareConfigFile(options); //will invoke reloadBackendConfig if anything changed

    //Which config files to update
    const generateContext = await buildGeneratorContext(null, verbose || false);
    if (togenerate.size) {
      if (verbose)
        console.log(`Update generated files: ${[...togenerate].join(", ")}`);

      await updateGeneratedFiles([...togenerate], { verbose: verbose, nodb: options.nodb, dryRun: false, generateContext });
    }

    if (todoList.includes('assetpacks')) {
      const assetpackcontroller = await openBackendService("platform:assetpacks", ["apply assetpacks"]);
      await assetpackcontroller.reload();
    }

    if (todoList.includes('registry')) {
      /* Initialize missing registry keys. This should be done before eg. WRD so that wrd upgrade scripts can read the registry

         We could port this to JS... but then we'd have to process XML too *and* HS would have to be updated to process YML keys too (to match expectations)
         And we can't drop the HS part yet as it's very early in DB init/bootstrap.. until we do that part of the bootstrap too
         So just use the HS implementation for now and we'll see when we get around to YML registry keys */
      await loadlib("mod::system/lib/internal/modules/moduleregistry.whlib").InitModuleRegistryKeys(options.modules || Object.keys(backendConfig.module));
    }

    if (todoList.includes('wrd')) {
      //Update WRD schemas (TODO limit ourselves based on module mask)
      if (options.verbose)
        console.log("Updating WRD schemas based on their schema definitions");

      const applyupdates = loadlib("mod::wrd/lib/internal/metadata/applyupdates.whlib");
      const schemamasks = options?.modules ? options?.modules.map(_ => `${_}:*`) : [];
      //FIXME if some schemas fail, report this. but we're still missing a 'warning' channel back to the 'wh apply wrd' caller
      await applyupdates.UpdateAllModuleSchemas({ schemamasks, reportupdates: true, reportskips: verbose, force: options.force });

      await beginWork();
      await scheduleTimedTask("wrd:scanforissues");
      await commitWork();

      await updateGeneratedFiles(["wrd"], { verbose, nodb: false, dryRun: false, generateContext });
    }

    if (todoList.includes('siteprofiles')) {
      await loadlib("mod::publisher/lib/internal/siteprofiles/compiler.whlib").__DoRecompileSiteprofiles(true, false, true);
    } else if (todoList.includes('siteprofilerefs')) {
      await loadlib("mod::publisher/lib/internal/siteprofiles/reader.whlib").UpdateSiteProfileRefs(null);
    }

    logDebug("platform:configuration", { type: "done", at: Date.now() - start });
  } catch (e) {
    logDebug("platform:configuration", { type: "error", at: Date.now() - start, message: (e as Error)?.message ?? "", stack: (e as Error)?.stack ?? "" });
    throw e;
  }
}
