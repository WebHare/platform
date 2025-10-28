/*
To debug:
WEBHARE_DEBUG=assetpacks wh service debug platform:assetpacks
*/

import type { ServiceControllerFactoryFunction } from "@webhare/services/src/backendservicerunner";
import { BackendServiceConnection, type BackendServiceController, broadcast, logDebug, scheduleTask, subscribe, toFSPath, type BackendEvent } from "@webhare/services";
import { throwError, wrapSerialized } from "@webhare/std";
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { buildRecompileSettings, recompile } from "@mod-platform/js/assetpacks/compiletask";
import type { AssetPack } from "@mod-system/js/internal/generation/gen_extracts";
import { debugFlags } from "@webhare/env";
import * as fs from "node:fs/promises";
import { loadAssetPacksConfig, type AssetPacksConfig } from "./api";
import { runInWork } from "@webhare/whdb";
import { getAssetPackState, readBundleSettings, writeBundleSettings, type BundleSettings } from "./support";
import type { AssetPackState } from "./types";
import type { AssetPackBundleStatus, AssetPackMiniStatus } from "../devsupport/devbridge";

let updatedAssetPacks: Set<string> | undefined;

function flushBroadcasts() {
  if (updatedAssetPacks)
    broadcast("platform:assetpackcontrol.update", { assetpacks: [...updatedAssetPacks] });
  updatedAssetPacks = undefined;
}

function broadcastAssetPackChange(name: string) {
  if (!updatedAssetPacks) {
    updatedAssetPacks = new Set;
    setTimeout(flushBroadcasts, 1);
  }
  updatedAssetPacks.add(name);
}

class LoadedBundle {
  dirtyReason = '';
  forceCompile = false;
  /** Set if we're compiling - also functions as a lock to prevent parallel compilations of the same assetpack */
  recompiling: Promise<void> | null = null;
  fileDeps = new Set<string>();
  missingDeps = new Set<string>();
  state: AssetPackState | null = null;

  constructor(private readonly controller: AssetPackController, public readonly name: string, private config: AssetPack, private settings: BundleSettings, state: AssetPackState | null) {
    if (state)
      this.updateState(state);
    this.checkIfDirtied();
  }

  getStatus(): AssetPackMiniStatus {
    return {
      id: 0,
      hasstatus: Boolean(this.state),
      iscompiling: Boolean(this.recompiling),
      requirecompile: Boolean(this.dirtyReason),
      haserrors: Boolean(this.state?.messages.some(_ => _.type === "error")),
      haswarnings: Boolean(this.state?.messages.some(_ => _.type === "warning")),
      outputtag: this.name,
      lastcompile: this.state?.start || null,
      isdev: this.settings.dev,
      watchcount: this.controller.clients.values().filter(client => client.watchlist.has(this.name)).reduce((acc, _) => acc + 1, 0),
      compatibility: this.config.compatibility
    };
  }

  getBundleStatus(): AssetPackBundleStatus {
    return {
      ...this.getStatus(),
      messages: this.state?.messages || [],
      filedependencies: [...this.fileDeps],
      missingdependencies: [...this.missingDeps],
      entrypoint: this.config.entryPoint,
      bundleconfig: {
        extrarequires: this.config.extraRequires,
        languages: this.config.supportedLanguages,
        environment: this.config.environment
      }
    };
  }

  updateConfig(config: AssetPack, settings: BundleSettings) {
    this.config = config;
    this.settings = settings;
    this.checkIfDirtied();
  }

  checkIfDirtied() {
    if (this.dirtyReason)
      return;

    try {
      if (!this.state)
        this.markDirty("has never been compiled before");
      else if (this.config.baseCompileToken !== this.state.lastCompileSettings.bundle.config.baseCompileToken)
        this.markDirty("compiletoken (configuration) hash changed");
      else if (this.settings.dev !== this.state.lastCompileSettings.bundle.isdev)
        this.markDirty("settings (dev/prod) changed");
    } catch (e) {
      this.markDirty(`configuration error: ${(e as Error)?.message ?? "unknown error"}`);
    }
  }

  private updateState(state: AssetPackState) {
    this.state = state;
    if (!this.state.messages) //if messages are missing, we've loaded 5.7-dev incomplete final state. fixup
      this.state.messages = [{ type: "error", resourcename: "", line: 0, col: 0, message: "Recompile needed", source: "platform:assetpackcontrol" }];
    this.fileDeps = new Set(state.fileDependencies);
    this.missingDeps = new Set(state.missingDependencies);
    void this.checkDeps(); // no need to await the update
    broadcastAssetPackChange(this.name);
  }

  private async checkDepList(deps: Set<string>, recompileIfMissing: boolean) {
    if (!this.state)
      return; //no config loaded yet, this may happen if the package was *never* compiled, autocompile is off, but loadAssetPacks (eg wh apply assetpacks) triggered a reload

    const lastCompileStart = this.state.start.getTime();
    for (let file of deps) {
      if (this.dirtyReason)
        return;

      //Is this file modified since last compile?
      file = toFSPath(file, { allowUnmatched: true }) ?? file;
      try {
        const mtime = (await fs.stat(file)).mtimeMs;
        if (mtime >= lastCompileStart)
          this.markDirty("dependency file changed: " + file);
      } catch (e) {
        if (recompileIfMissing)
          this.markDirty("dependency file missing: " + file);
      }

    }
  }
  /** Rescan the dependencies */
  async checkDeps() {
    await this.checkDepList(this.fileDeps, true);
    await this.checkDepList(this.missingDeps, false);
  }

  informResourceChange(path: string) {
    if (this.dirtyReason)
      return; //already dirty

    if (this.fileDeps.has(path) || this.missingDeps.has(path)) {
      this.markDirty("dependency file changed: " + path);
    }
  }

  markDirty(reason: string, { forceCompile = false } = {}) {
    if (this.dirtyReason && !forceCompile)
      return; //already dirty, eg caller is async and missed it
    if (debugFlags.assetpacks)
      console.log("Marking", this.name, "dirty because", reason);

    this.dirtyReason = reason;
    this.forceCompile ||= forceCompile;
    broadcastAssetPackChange(this.name);
    this.startCompile();
  }

  /** Check if the bundle should recompile? */
  shouldRecompile() {
    if (!this.dirtyReason)
      return false;

    // These bundles should always recompile, even if dirty, as they aren't easily watched. TODO make it a setting in assetpacks yml ?
    if (this.forceCompile || this.name === "dev:devtools") //this one implements watching, so if it's broken there's noone to report it
      return true;

    if (this.controller.config.suspendAutoCompile && !this.controller.isWatched(this.name))
      return false;

    return true;
  }

  /** Start compile if needed */
  startCompile() {
    if (this.recompiling || !this.shouldRecompile())
      return;

    let compilePromise;
    try {
      if (debugFlags.assetpacks)
        console.log("Starting recompile for", this.name, this.settings, "because", this.dirtyReason);
      logDebug("platform:assetpacks", { type: "recompile", bundle: this.name, reason: this.dirtyReason, settings: this.settings });

      this.dirtyReason = '';
      this.forceCompile = false;
      broadcastAssetPackChange(this.name);
      compilePromise = recompile(buildRecompileSettings(this.config, this.settings));
    } catch (e) {
      console.error('Recompile exception', e); //TODO what to do to prevent a stuck assetpack? what kind of exceptions can happen?
      return;
    }

    //We need to set recompiling to a promise that resolves *AFTER* updateState has been set/recompiling is null.
    this.recompiling = compilePromise.then(async result => {
      if (debugFlags.assetpacks)
        console.log("recompiled", this.name);

      // Schedule aftercompileTasks before marking the compile as done so compile waiters can wait for the aftercompiletask next.
      if (this.config.afterCompileTask) //this lock is to prevent *ourselves* from running ANY concurrent works. TODO a codecontext-level lock for *that* would be enough
        await runInWork(() => scheduleTask(this.config.afterCompileTask, { assetpack: this.name }), { mutex: "platform:assetpacks-scheduletask" });

      //Update the state
      this.updateState(result);

      //And only *then* will we allow a new compile to start
      this.recompiling = null;

      //Check if a compile was scheduled, or if we're already dirty again
      this.startCompile();
    }).catch(e => {
      this.recompiling = null;
      console.log("Recompile Failed", this.name, e);
    });
  }

  forceRecompile() {
    this.markDirty("by user request", { forceCompile: true });
  }

  async updateSettings(newSettings: Partial<BundleSettings>) {
    if (debugFlags.assetpacks)
      console.log("Updating settings for", this.name, newSettings);

    this.updateConfig(this.config, await writeBundleSettings(this.name, newSettings));
    broadcastAssetPackChange(this.name);

    this.checkIfDirtied();
  }

  async waitForCompile() {
    if (this.dirtyReason && !this.recompiling) {
      this.forceCompile = true;
      this.startCompile();
    }

    if (this.recompiling) //wait for compilation to compile or throw:
      await this.recompiling.then(() => void undefined, () => void undefined);

    return this.getStatus();
  }
}

class AssetPackController implements BackendServiceController {
  bundles = new Map<string, LoadedBundle>();
  clients = new Set<AssetPackControlClient>();
  firstConfig = Promise.withResolvers<void>();

  constructor(public config: AssetPacksConfig) {
    void subscribe("system:modulefolder.*", this.onChangedFile);
    void subscribe("system:npmlinkroot.filechange.*", this.onChangedFile);
    void subscribe("system:modulesupdate", () => void this.reload());

    this.loadAssetPacks().catch(e => console.error(e)).finally(() => this.firstConfig.resolve());
  }

  onChangedFile = (events: BackendEvent[]) => {
    for (const event of events) {
      let res = event.data?.resourcename as string | undefined;
      if (!res)
        continue;

      //TODO pre-filtering eg generated/ urls in the watcher might be nice to reduce invalidation traffic?
      if (res.startsWith("direct::")) //updates to resources outside mod:: aret transmitted as direct:: paths, but assetpack state stores simply the fullpath, so translate!
        res = res.substring(8);

      for (const bundle of this.bundles.values()) {
        bundle.informResourceChange(res as string);
      }
    }
  };

  loadAssetPacks = wrapSerialized(async () => {
    for (const config of getExtractedConfig("assetpacks")) {
      const settings = await readBundleSettings(config.name);
      const pack = this.bundles.get(config.name);
      if (pack) {
        pack.updateConfig(config, settings);
        await pack.checkDeps(); //if we need to update already loaded packs, it's probably a module push (or reconfiguration) so just check the deps again
        pack.startCompile(); //recheck whether it needs to compile (needed when autocompile is re-enabled)
      } else {
        this.bundles.set(config.name, new LoadedBundle(this, config.name, config, settings, await getAssetPackState(config.name)));
      }
    }

    if (debugFlags.assetpacks)
      console.log(`Configuration loaded, ${this.bundles.size} bundles active`);
  });

  async createClient(source: string) {
    /* avoid responding to clients until the initial configuration is loaded to prevent a race where eg 'wh assetpack check'
       is very fast to connect to the newly created controller and we haven't completed our first loadAssetPacks() yet
       leading to eg "Bundle 'webhare_testsuite:basetest' not found" from webhare_testsuite:reset */
    await this.firstConfig.promise;
    const client = new AssetPackControlClient(this, source);
    this.clients.add(client);
    return client;
  }

  disconnectedClient(client: AssetPackControlClient) {
  }

  reload = wrapSerialized(async () => {
    const config = await loadAssetPacksConfig();
    this.config = config;
    await this.loadAssetPacks();
  });

  isWatched(assetpack: string): boolean {
    return this.clients.values().some(_ => _.watchlist.has(assetpack));
  }
}

class AssetPackControlClient extends BackendServiceConnection {
  watchlist = new Set<string>;

  constructor(private controller: AssetPackController, public source: string) {
    super();
  }
  async reload() {
    return await this.controller.reload();
  }
  watchAssetPack(name: string) {
    this.watchlist.add(name);
    this.controller.bundles.get(name)?.startCompile();
  }
  onClose() {
    this.controller.disconnectedClient(this);
  }

  async getStatus() { //used by dashboard and CLI wh assetpacks
    return { bundles: [...this.controller.bundles.values().map(bundle => bundle.getStatus())] };
  }
  async getBundleStatus(tag: string) {
    return this.controller.bundles.get(tag)?.getBundleStatus() || null;
  }
  async recompileBundle(tag: string) {
    this.controller.bundles.get(tag)?.forceRecompile();
  }
  async recompileBundles(tags: string[]) {
    for (const tag of tags)
      this.controller.bundles.get(tag)?.forceRecompile();
  }
  async updateBundleSettings(tag: string, newSettings: Partial<BundleSettings>) {
    const bundle = this.controller.bundles.get(tag) ?? throwError(`Bundle '${tag}' not found`);
    return await bundle.updateSettings(newSettings);
  }

  /** Returns a promise that is resolved when the first compile for a bundle has finished (with a timeout of 2 minutes)
  */
  async waitForCompile(tag: string) {
    const bundle = this.controller.bundles.get(tag) ?? throwError(`Bundle '${tag}' not found`);
    return await bundle.waitForCompile();
  }
}

export async function createAssetPackManager(options?: { debug?: boolean }): Promise<AssetPackController> {
  if (options?.debug)
    debugFlags.assetpacks = true;

  return new AssetPackController(await loadAssetPacksConfig());
}

createAssetPackManager satisfies ServiceControllerFactoryFunction;
export { type AssetPackControlClient };
