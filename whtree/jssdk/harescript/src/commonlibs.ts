/* eslint-disable @typescript-eslint/no-explicit-any -- We don't want to spell out everything HS supports so we prefer any instead of unknown here */
import { WebHareBlob } from "@webhare/services/src/webhareblob";
import { type HSVMCallsProxy } from "./wasm-proxies";

interface Mod_Publisher_Lib_Siteapi_Site {
  openByPath(path: string): Promise<(Mod_System_Lib_WHFS_WHFSObject & HSVMCallsProxy) | null>;
}

interface Mod_System_Lib_WHFS_WHFSObject {
  $get(field: "id"): Promise<number>;
  $get(field: "publish"): Promise<boolean>;

  $get(field: string): Promise<any>;
}

interface Mod_Publisher_Lib_Siteapi_Base {
  openSiteByName(name: string): Promise<(Mod_Publisher_Lib_Siteapi_Site & HSVMCallsProxy) | null>;
}

interface Wh_Filetypes_Archiving {
  unpackArchive(data: WebHareBlob): Promise<Array<{
    path: string;
    name: string;
    modtime: Date;
    data: WebHareBlob;
  }>>;
}

interface Mod_System_Lib_Database_PrimaryObject {
  isWorkOpen(): Promise<boolean>;
}

interface Mod_System_Lib_Database_Base {
  getPrimary(): Promise<(Mod_System_Lib_Database_PrimaryObject & HSVMCallsProxy) | null>;
}

interface Mod_System_Lib_WHFS_Base {
  openWHFSObject(id: number): Promise<(Mod_System_Lib_WHFS_WHFSObject & HSVMCallsProxy) | null>;
}

export type Mod_System_Lib_Database = Mod_System_Lib_Database_Base & HSVMCallsProxy;
export type Mod_System_Lib_WHFS = Mod_System_Lib_WHFS_Base & HSVMCallsProxy;
export type Mod_Publisher_Lib_Siteapi = Mod_Publisher_Lib_Siteapi_Base & HSVMCallsProxy;


export interface CommonLibraries {
  "wh::filetypes/archiving.whlib": Wh_Filetypes_Archiving;
  "mod::system/lib/database.whlib": Mod_System_Lib_Database;
  "mod::system/lib/whfs.whlib": Mod_System_Lib_WHFS;
  "mod::publisher/lib/siteapi.whlib": Mod_Publisher_Lib_Siteapi;
}

export type CommonLibraryType<LibraryURI extends keyof CommonLibraries> = CommonLibraries[LibraryURI];
