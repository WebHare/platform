import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { dtapStage } from "@webhare/env";
import { backendConfig, toFSPath } from "@webhare/services";
import { parseTyped, stringify } from "@webhare/std";
import { listDirectory, storeDiskFile } from "@webhare/system-tools";
import { stat, readFile, mkdir, rm } from "node:fs/promises";
import type { AssetPackState } from "./types";

export type BundleSettings = Awaited<ReturnType<typeof readBundleSettings>>;

function getBasePath(isPlatform: boolean): string {
  return isPlatform ? toFSPath("mod::platform/generated/") : `${backendConfig.dataroot}generated/platform/`;
}

export function getBundleMetadataPath(bundle: string): string {
  return `${getBasePath(bundle.startsWith("platform:"))}ap.metadata/${bundle.replaceAll(":", ".")}/`;
}

export function getBundleOutputPath(bundle: string): string {
  return `${getBasePath(bundle.startsWith("platform:"))}ap/${bundle.replaceAll(":", ".")}/`;
}

function mergeSettingsInto(base: BundleSettings, newSettings: Partial<BundleSettings>): void {
  for (const key of Object.keys(base) as Array<keyof BundleSettings>)
    if (key in newSettings && typeof newSettings[key] === typeof base[key])
      base[key] = newSettings[key]!;
}

export async function readBundleSettings(bundleTag: string) {
  const settingsfile = getBundleMetadataPath(bundleTag) + "settings.json";
  const settings = {
    dev: dtapStage === "development" // for speed, assume dev mode for developer servers
      && !(process.env.WEBHARE_IN_DOCKER && bundleTag.startsWith("platform:")) // but keep production for the platform: bundles in docker or we'll just rebuild the finalized versions
  };

  try {
    //copy existing settings if they match the type..
    const diskSettings = JSON.parse(await readFile(settingsfile, "utf-8"));
    mergeSettingsInto(settings, diskSettings);
  } catch {
    // ignore
  }

  return settings;
}

/** Update on disk settings
 * @param bundleTag - The bundle to update settings for
 * @param settings - The settings to update
 * @returns The current updated settings (includes unchanged settings)
 */
export async function writeBundleSettings(bundleTag: string, settings: Partial<BundleSettings>): Promise<BundleSettings> {
  //ensure settings directory exists
  await mkdir(getBundleMetadataPath(bundleTag), { recursive: true });
  //merge into existing settings
  const storeSettings = await readBundleSettings(bundleTag);
  mergeSettingsInto(storeSettings, settings);
  await storeDiskFile(getBundleMetadataPath(bundleTag) + "settings.json", stringify(storeSettings, { space: 2, stable: true }) + '\n', { overwrite: true });

  return storeSettings;
}

export async function removeObsoleteCacheFolders() {
  const bundles = getExtractedConfig("assetpacks");
  const expectPaths = new Set([
    ...bundles.map(bundle => getBundleMetadataPath(bundle.name)),
    ...bundles.map(bundle => getBundleOutputPath(bundle.name))
  ]);

  for (const subfolder of ["ap", "ap.metadata"])
    for (const entry of await listDirectory(getBasePath(false) + subfolder, { allowMissing: true })) {
      if (entry.name.startsWith("adhoc-") && !entry.name.includes(".")) {
        if ((await stat(entry.fullPath)).mtimeMs > Date.now() - 3_600_000) //less than an hour old
          continue; //a grace period for adhoc- packages
      }
      if (!expectPaths.has(`${entry.fullPath}/`))
        await rm(entry.fullPath, { recursive: true });

    }
}

export async function getAssetPackState(bundle: string): Promise<AssetPackState | null> {
  const statspath = getBundleMetadataPath(bundle);
  try {
    const data = await readFile(statspath + "state.json", { encoding: 'utf8' });
    return parseTyped(data);
  } catch {
    return null;
  }
}

export async function getAssetPackMetaDataFile(bundle: string): Promise<string> {
  const statspath = getBundleMetadataPath(bundle);
  try {
    return await readFile(statspath + "metafile.json", { encoding: 'utf8' });
  } catch {
    return '';
  }
}
