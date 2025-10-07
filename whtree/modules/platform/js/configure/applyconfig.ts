import { buildGeneratorContext, updateGeneratedFiles } from '@mod-system/js/internal/generation/generator';
import { generatorTypes, type GeneratorType } from '@mod-system/js/internal/generation/shared';
import { loadlib } from '@webhare/harescript';
import { beginWork, commitWork } from '@webhare/whdb';
import { backendConfig, broadcast, lockMutex, logDebug, openBackendService, scheduleTimedTask } from "@webhare/services";
import { updateWebHareConfigFile } from '@mod-system/js/internal/generation/gen_config';
import { updateConsilioCatalogs } from './consilio';
import { updateTypeScriptInfrastructure } from '@mod-system/js/internal/generation/gen_typescript';

type SubsystemConfig = {
  generate?: readonly GeneratorType[];
};

type SubsystemData = {
  title: string;
  description: string;
  /** Specific update targetting, eg wrd.ts to update just the wh:wrd/ TS files. Should be considered an internal API */
  parts?: Record<string, SubsystemConfig>;
} & SubsystemConfig;


const subsystems = {
  assetpacks: { title: "Assetpacks", description: "Update active assetpacks", generate: ["extracts"] },
  /* 'wh apply config' should
      - ensure all code can run after updating a module
        - so it also needs to update any non type-only TS Files  */
  config: {
    title: "Configuration",
    description: "Update configuration files and development infrastructure (imports, schemas)",
    generate: generatorTypes,
    parts: {
      //config.base if you're only here to update eg. the backend URL or module map
      base: { generate: ["config"] },
      extracts: { generate: ["config", "extracts"] },
      whfs: { generate: ["whfs"] },
      wrd: { generate: ["wrd"] },
      db: { generate: ["db"] },
      schemas: { generate: ["schema"] },
      devkit: { generate: ["devkit"] }
    }
  },
  registry: {
    title: "Registry",
    description: "Initialize registry keys defined in module definitions",
    generate: ["ts"]
  },
  wrd: {
    title: "WRD",
    description: "Apply wrdschema definitions and regenerate the TS definitions",
    generate: ["wrd"],
    parts: {
      ts: { generate: ["wrd"] }
    }
  },
  consilio: {
    title: "Consilio",
    description: "Define catalogs in the database and schedule updating the index managers",
  },
  siteprofiles: {
    title: "Siteprofiles",
    description: "Recompile site profiles",
    generate: ["extracts"] //we need the plugins extract to be up to date
  },
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
  showUnchanged?: boolean;
  force?: boolean;
  nodb?: boolean;
  source: string;
  /** Assume we're still in the bootstrap phase */
  __bootstrap?: boolean;
  /** If set, do not block the apply backend service (dangerous if WebHare is running!) */
  offline?: boolean;
}

export async function executeApply(options: ApplyConfigurationOptions & { offline?: boolean }) {
  // The mutex prevents 'wh apply' and backend service from aplying configuration at the same time
  using mutex = options.offline ? null : await lockMutex("platform:applyconfig");
  void (mutex);

  const start = Date.now();
  const verbose = Boolean(options.verbose);
  const togenerate = new Set<GeneratorType>;
  logDebug("platform:configuration", { type: "apply", ...options });

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
    if (togenerate.has('config')) { //regenerating config must be done before buildGeneratorContext or there'll be no module mapping in the backendConfig!
      await updateWebHareConfigFile(options); //will invoke reloadBackendConfig if anything changed
      await updateTypeScriptInfrastructure(options); // Setup symlinks and helper files needed by JS/TS code to run (ie tsconfig.json, node_modules symlinks)
    }

    //Which config files to update
    const generateContext = await buildGeneratorContext(null, verbose || false);
    if (togenerate.size) {
      const timer = `Update generated files: ${[...togenerate].join(", ")}`;
      if (verbose)
        console.time(timer);

      await updateGeneratedFiles([...togenerate], { verbose: verbose, nodb: options.nodb, dryRun: false, modules: options.modules, showUnchanged: options.showUnchanged, generateContext });

      if (verbose)
        console.timeEnd(timer);
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
      //Update WRD schemas
      if (options.verbose)
        console.time("Updating WRD schemas based on their schema definitions");

      const applyupdates = loadlib("mod::wrd/lib/internal/metadata/applyupdates.whlib");
      const schemamasks = options?.modules ? options?.modules.map(_ => `${_}:*`) : [];
      //FIXME if some schemas fail, report this. but we're still missing a 'warning' channel back to the 'wh apply wrd' caller
      await applyupdates.UpdateAllModuleSchemas({ schemamasks, reportupdates: true, reportskips: verbose, force: options.force });

      if (!options.__bootstrap) { //during webhareservice startup the task may not be created yet
        await beginWork();
        await scheduleTimedTask("wrd:scanforissues", {});
        await commitWork();
      }

      if (options.verbose)
        console.timeEnd("Updating WRD schemas based on their schema definitions");
    }

    if (todoList.includes('siteprofiles')) {
      await loadlib("mod::publisher/lib/internal/siteprofiles/compiler.whlib").__DoRecompileSiteprofiles(true, false, true);
    } else if (todoList.includes('siteprofilerefs')) {
      await loadlib("mod::publisher/lib/internal/siteprofiles/reader.whlib").UpdateSiteProfileRefs(null);
    }

    if (todoList.includes('consilio')) {
      await updateConsilioCatalogs(generateContext, options);
    }

    broadcast("platform:appliedconfig");
    logDebug("platform:configuration", { type: "done", at: Date.now() - start });
  } catch (e) {
    if (verbose)
      console.error("Error occurred:", e);
    logDebug("platform:configuration", { type: "error", at: Date.now() - start, message: (e as Error)?.message ?? "", stack: (e as Error)?.stack ?? "" });
    throw e;
  }
}
