/* eslint-disable @typescript-eslint/no-explicit-any -- We don't want to spell out everything HS supports so we prefer any instead of unknown here */
import type { WebHareBlob } from "@webhare/services/src/webhareblob";
import type { HSVMCallsProxy } from "./wasm-proxies";
import type { ValidationOptions, ValidationResult } from "@mod-platform/js/devsupport/validation";

/* You can also declare your own loadlibs for TypeScript in your own modules. Put this in a TypeScript file:

declare module "@webhare/harescript/src/commonlibs" {
  interface CommonLibraries {
    "mod::<module>/path/to/your.whlib": {
      functionName(param1: string.. ): Promise< returnvalue >;
    };
  }
}

See hsapi.ts in the `dev` module for a practical example

*/


interface Mod_Publisher_Lib_Siteapi_Site {
  openByPath(path: string): Promise<(Mod_System_Lib_WHFS_WHFSObject & HSVMCallsProxy) | null>;
}

interface Mod_System_Lib_WHFS_WHFSObject {
  $get(field: "id"): Promise<number>;
  $get(field: "publish"): Promise<boolean>;

  $get(field: string): Promise<any>;
}

interface Mod_Publisher_Lib_Siteapi {
  openSiteByName(name: string): Promise<(Mod_Publisher_Lib_Siteapi_Site & HSVMCallsProxy) | null>;
}

interface Wh_Crypto {
  verifyWebHarePasswordHash(pwd: string, hash: string): Promise<boolean>;
  decryptSignedData(data: string, algorithm: string, encryptkey: string): Promise<string>;
}

interface Wh_Files {
  redirectOutputTo(stream: number): Promise<number>;
  makeBlobFromStream(stream: number): Promise<WebHareBlob>;
}

type Archive = {
  addFile(file: string, data: WebHareBlob, modtime: Date): Promise<void>;
  addFolder(file: string, modtime: Date): Promise<void>;
  makeBlob(): Promise<WebHareBlob>;
  close(): Promise<void>;
  removeEntries(path: string, mask: string): Promise<void>;
  addDiskFolderRecursive(diskpath: string, basepath: string): Promise<void>; // options are omitted, not supported from TS
  getFile(fullpath: string): Promise<WebHareBlob>;

  $get(field: "archivecomment"): Promise<string>;
  $get(field: "archivecomment", pvt_archivecomment: string): Promise<void>;
  $get(field: "entries"): Promise<Array<{
    /// Full path of the entry (path + name)
    fullpath: string;
    /// Type of the entry (0=file, 1=directory)
    type: number;
    /// Directory of the entry (full directory name for directories)
    path: string;
    /// Name of the file (empty for directories)
    name: string;
    /// Modification time of the file/directory
    modtime: Date;
    /// Size of the file (0 for directories)
    size64: number;
  }>>;
};

interface Wh_Filetypes_Archiving {
  unpackArchive(data: WebHareBlob): Promise<Array<{
    path: string;
    name: string;
    modtime: Date;
    data: WebHareBlob;
  }>>;
  createNewArchive(type: "zip", options?: { compressionlevel?: number }): Promise<Archive>;
}

interface Mod_System_Lib_Database_PrimaryObject {
  isWorkOpen(): Promise<boolean>;
}

interface Mod_System_Lib_Database {
  getPrimary(): Promise<(Mod_System_Lib_Database_PrimaryObject & HSVMCallsProxy) | null>;
}

interface Mod_System_Lib_Validation {
  validateSingleFile(resourcename: string, options?: ValidationOptions): Promise<ValidationResult>;
}

interface Mod_System_Lib_WHFS {
  openWHFSObject(id: number): Promise<(Mod_System_Lib_WHFS_WHFSObject & HSVMCallsProxy) | null>;
}

export interface CommonLibraries {
  "wh::crypto.whlib": Wh_Crypto;
  "wh::files.whlib": Wh_Files;
  "wh::filetypes/archiving.whlib": Wh_Filetypes_Archiving;
  "mod::system/lib/database.whlib": Mod_System_Lib_Database;
  "mod::system/lib/validation.whlib": Mod_System_Lib_Validation;
  "mod::system/lib/whfs.whlib": Mod_System_Lib_WHFS;
  "mod::publisher/lib/siteapi.whlib": Mod_Publisher_Lib_Siteapi;
}

export type CommonLibraryType<LibraryURI extends keyof CommonLibraries> = CommonLibraries[LibraryURI] & HSVMCallsProxy;
