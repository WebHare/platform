import { toFSPath } from "./resources.ts";
import * as fs from "node:fs";
import * as witty from '@webhare/witty';

export function loadWittyResource(resource: string, options?: witty.WittyOptions): Promise<witty.WittyTemplate> {
  /// 'null' loader would immediately break loadWittyTemplate so we'll let that just use the default
  const loader = options?.loader || readWittyResource;
  return witty.loadWittyTemplate(resource, { ...options, loader });
}

function readWittyResource(resource: string): Promise<string> {
  const respath = toFSPath(resource);
  return new Promise((resolve, reject) => {
    fs.readFile(respath, { encoding: "utf8" }, (error, data) => {
      if (error)
        reject(error);
      else
        resolve(data);
    });
  });
}
