import { fromMetaDatatoResized, type ResizeMethod } from "@webhare/services/src/descriptor";
import type { HareScriptResourceDescriptor } from "./richdocument";

export type ExportedTSDescriptor = {
  ts$resourcedescriptor: unknown;
};

export type ExportedTSDescriptorExplained = {
  ts$resourcedescriptor: {
    id: bigint;
    source: number;
    setting: Omit<HareScriptResourceDescriptor, "data" | "blobsource" | "mirrored" | "rotation">;
    cc: number;
  };
};

/** Resize a wrapped blob exported using mod::system/lib/cache.whlib#ExportTSDescriptor */
export async function resizeTSDescriptor(descriptor: ExportedTSDescriptor, resize: ResizeMethod) {
  const d = (descriptor as ExportedTSDescriptorExplained).ts$resourcedescriptor;
  return fromMetaDatatoResized(1, {
    refPoint: d.setting.refpoint,
    dominantColor: d.setting.dominantcolor,
    mediaType: d.setting.mimetype,
    fileName: d.setting.filename,
    width: d.setting.width,
    height: d.setting.height,
    hash: d.setting.hash,
    dbLoc: { source: d.source, id: Number(d.id), cc: d.cc }
  }, resize);
}
