import fs from "node:fs";
import type { WebHareModuleConfiguration } from "@webhare/services/src/bridgeservice";
import { pick } from "@mod-system/js/internal/util/algorithms";

export function getRescueOrigin() {
  const rescueip = process.env["WEBHARE_RESCUEPORT_BINDIP"] || "127.0.0.1";
  const rescueport = process.env["WEBHARE_BASEPORT"] || "13679";
  return `http://${rescueip}:${rescueport}`;
}

function appendSlashWhenMissing(path: string) {
  return !path || path.endsWith("/") ? path : path + "/";
}

type ModuleData = {
  path: string;
  creationdate: Date;
};

export type WebHareModuleMap = { [name: string]: Readonly<WebHareModuleConfiguration> };

/** Class that calculates WebHare configuration from environment variables / module disk paths  */
class WebHareConfig {
  baseport: number;
  basedatadir: string;
  installationroot: string;
  modulescandirs = new Array<string>;
  module: WebHareModuleMap = {};

  constructor() {
    this.baseport = Number(process.env.WEBHARE_BASEPORT || "0");
    this.basedatadir = appendSlashWhenMissing(process.env.WEBHARE_DATAROOT ?? "");
    this.installationroot = appendSlashWhenMissing(process.env.WEBHARE_DIR ?? "");

    if (this.baseport == 0)
      this.baseport = 13679; //default port, needed for backwards compatibility
    if (this.baseport < 1024 || this.baseport > 65500)
      throw new Error("Invalid WEBHARE_BASEPORT");
    if (!this.basedatadir)
      throw new Error("Invalid WEBHARE_DATAROOT");
    if (!this.installationroot)
      throw new Error("Cannot determine the WebHare installation root");

    this.modulescandirs.push(this.basedatadir + "installedmodules/");

    const env_modulepaths = process.env.WEBHARE_MODULEPATHS ?? "";
    if (env_modulepaths) {
      for (const path of env_modulepaths.split(":").filter(p => p))
        this.modulescandirs.push(appendSlashWhenMissing(path));
    }

    this.reloadPluginConfig();
  }

  reloadPluginConfig() {
    const modulemap = new Map<string, ModuleData>;
    for (const moduledir of this.modulescandirs)
      this.scanModuleFolder(modulemap, moduledir, true, false);
    this.scanModuleFolder(modulemap, this.installationroot + "modules/", true, true);
    this.module = Object.freeze(Object.fromEntries(Array.from(modulemap).map(([name, { path }]: [string, { path: string }]) => [name, { root: path }])));
  }

  private scanModuleFolder(modulemap: Map<string, ModuleData>, folder: string, rootfolder: boolean, always_overwrites: boolean) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch (e) {
      // not a directory
      return;
    }

    for (const entry of entries) {
      if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name === "deleted")
        continue;

      const modpath = folder + entry.name + "/";
      let creationdate = new Date(Date.parse("1970-01-01T00:00:00Z"));
      if (!fs.statSync(modpath + "moduledefinition.xml", { throwIfNoEntry: false })) {
        if (rootfolder)
          this.scanModuleFolder(modulemap, modpath, false, always_overwrites);
        else {
          // console.log(`skipping folder ${modpath}, it has no moduledefinition`);
        }
        continue;
      }
      let name = entry.name;
      const dotpos = name.indexOf('.');
      if (dotpos !== -1) {
        const dateparts = name.match(/\.(20\d\d)(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(\.\d\d\d)?Z$/);
        if (!dateparts) {
          continue;
        }
        const isofulldate = `${dateparts[1]}-${dateparts[2]}-${dateparts[3]}T${dateparts[4]}:${dateparts[5]}:${dateparts[6]}${dateparts[7]}`;
        const isofulldate_msecs = Date.parse(isofulldate);
        if (!isofulldate_msecs) {
          // Invalid ISO date, ignore module
          continue;
        }
        creationdate = new Date(isofulldate_msecs);
        name = name.substring(0, dotpos);
      }

      const mdata = { creationdate, path: modpath };

      const current = modulemap.get(name);
      if (current) {
        if (!always_overwrites && current.creationdate >= creationdate) {
          //console.log(`Older module version found at ${modpath}`);
          continue;
        }
        //console.log(`New module version found at ${modpath}`);
      }
      modulemap.set(name, mdata);
    }
  }
}

const expose_keys = ["baseport", "basedatadir", "installationroot", "modulescandirs", "module"] as const;
export type WebHareConfiguration = Readonly<Pick<WebHareConfig, typeof expose_keys[number]>>;

export function calculateWebHareConfiguration(): WebHareConfiguration {
  const config = new WebHareConfig;
  return pick(config, expose_keys);
}

export function calculateWebHareModuleMap(): WebHareModuleMap {
  return (new WebHareConfig).module;
}
