import type { TypedRestRequest } from "@mod-platform/generated/openapi/platform/api";
import type { AuthorizedWRDAPIUser, HTTPSuccessCode, OpenAPIResponse, OpenAPIResponseType } from "@webhare/openapi-service";
import { getAuthorizationInterface } from "@webhare/auth";
import { listInstances, openFileOrFolder, whfsType, type WHFSObject } from "@webhare/whfs";
import { getVirtualObjectData } from "@webhare/whfs/src/export";
import { runInWork } from "@webhare/whdb";
import { getType } from "@webhare/whfs/src/describe";
import { exportFileAsFetch, type ExportOptions, type ImportOptions } from "@webhare/services/src/descriptor";
import { resolveVirtualMetaData, type ImportedVirtualMetaData } from "@webhare/whfs/src/import";
import { dirname } from "path";

class WHFSAPIError extends Error {
  constructor(message: string, public statusCode: 400 | 403 | 404) {
    super(message);
  }
}

export async function resolvePath(req: { params: { path?: string }; authorization: { userId: number } }): Promise<WHFSObject> {
  const target = await openFileOrFolder(req.params.path || "/", { allowRoot: true, allowMissing: true });
  if (!target)
    throw new WHFSAPIError(`Path not found: ${req.params.path || "/"}`, 404);
  if (!await getAuthorizationInterface(req.authorization.userId).hasRightOn("system:fs_browse", target.id || "all"))
    throw new WHFSAPIError(`Access denied to path: ${req.params.path || "/"}`, 403);
  return target;
}

async function getInstances(obj: WHFSObject, exportOptions: ExportOptions) {
  const instanceList: OpenAPIResponseType<TypedRestRequest<AuthorizedWRDAPIUser, "get /whfs/object">, HTTPSuccessCode.Ok>["instances"] = [
    {
      whfsType: 'platform:virtual.objectdata',
      clone: 'onCopy',
      data: await getVirtualObjectData(obj, { includeData: true })
    }
  ];

  const instances = await listInstances(obj.id);
  for (const instance of instances) {
    if (instance.orphan)
      continue;

    const data = await whfsType(instance.scopedType || instance.namespace).get(obj.id, exportOptions);
    instanceList.push({
      whfsType: instance.scopedType || instance.namespace,
      clone: instance.clone,
      data: data || {}
    });
  }

  return instanceList;
}

export async function exportWHSFObject(targetObj: WHFSObject, instances: string, exportOptions: ExportOptions): Promise<OpenAPIResponseType<TypedRestRequest<AuthorizedWRDAPIUser, "get /whfs/object">, HTTPSuccessCode.Ok>> {
  const result: OpenAPIResponseType<TypedRestRequest<AuthorizedWRDAPIUser, "get /whfs/object">, HTTPSuccessCode.Ok> = {
    name: targetObj.name,
    whfsPath: targetObj.whfsPath,
    modified: targetObj.modified.toString(),
    type: targetObj.type,
    ...(targetObj.isFolder ? { isFolder: true } : {}),
    ...(targetObj.link ? { link: targetObj.link } : {})
  };

  if (instances) {
    result.instances = await getInstances(targetObj, exportOptions);
  }
  return result;
}

export async function getWHFSObject(req: TypedRestRequest<AuthorizedWRDAPIUser, "get /whfs/object">): Promise<OpenAPIResponse> {
  try {
    if (req.params.instances && req.params.instances !== "*")
      return req.createErrorResponse(400, { error: "instances parameter must be '*' if set" });

    const targetObj = await resolvePath(req);
    const result = await exportWHSFObject(targetObj, req.params.instances || '', { export: true, exportFile: exportFileAsFetch });
    if (targetObj.isFolder && req.params.children === true) {
      result.children = (await targetObj.list(["modified", "type", "link"])).map(item => ({
        name: item.name,
        whfsPath: targetObj.whfsPath + item.name + (item.isFolder ? "/" : ""),
        modified: item.modified.toString(),
        type: item.type,
        ...item.isFolder ? { isFolder: true } : {},
        ...(item.link ? { link: item.link } : {})
      }));
    }
    return req.createJSONResponse(200, result);
  } catch (e) {
    if (e instanceof WHFSAPIError) {
      return req.createErrorResponse(e.statusCode, { error: e.message });
    }
    throw e;
  }
}

async function mapVirtualMetaData(target: WHFSObject | null, data: Record<string, unknown>, importOptions?: ImportOptions): Promise<ImportedVirtualMetaData | null> {
  const result = await resolveVirtualMetaData(target, data, importOptions);
  if (result.errors.length > 0)
    throw new WHFSAPIError(`Invalid virtual metadata: ${result.errors.join("; ")}`, 400);

  return result.data;
}

async function applyInstanceUpdates(obj: WHFSObject, instances: TypedRestRequest<AuthorizedWRDAPIUser, "post /whfs/object">["body"]["instances"], importOptions?: ImportOptions) {
  for (const instance of instances || []) {
    if (instance.whfsType === "platform:virtual.objectdata")
      continue;
    const typeHandler = whfsType(instance.whfsType);
    await typeHandler.set(obj.id, instance.data as object || {}, importOptions);
  }
}

export async function createWHFSObject(req: TypedRestRequest<AuthorizedWRDAPIUser, "post /whfs/object">): Promise<OpenAPIResponse> {
  try {
    const parentFolder = await resolvePath(req);
    if (!parentFolder.isFolder) {
      return req.createErrorResponse(400, { error: `Cannot create object inside a file: ${parentFolder.whfsPath}` });
    }

    return await runInWork(async () => {
      const virtualMetadata = req.body.instances?.find(_ => _.whfsType === "platform:virtual.objectdata")?.data;
      const typeinfo = getType(req.body.type);
      if (!typeinfo)
        return req.createErrorResponse(400, { error: `Unknown type: ${req.body.type}` });
      if (!typeinfo.filetype && !typeinfo.foldertype)
        return req.createErrorResponse(400, { error: `Type is neither a file nor a folder type: ${req.body.type}` });

      const newObj = await parentFolder[typeinfo.foldertype ? "createFolder" : "createFile"](req.body.name, {
        type: req.body.type,
        ...virtualMetadata && await mapVirtualMetaData(null, virtualMetadata) || {}
      });
      await applyInstanceUpdates(newObj, req.body.instances);
      return req.createJSONResponse(201, {});
    });
  } catch (e) {
    if (e instanceof WHFSAPIError) {
      return req.createErrorResponse(e.statusCode, { error: e.message });
    }
    throw e;
  }
}

async function unmapWhfsLink(targetObject: WHFSObject, ref: string) {
  if (!ref.includes("::")) {
    //local reference
    let base = targetObject.whfsPath;
    if (!targetObject.isFolder) //strip last component
      base = dirname(base);

    const target = await openFileOrFolder(base + "/" + ref);
    return target.id;
  }
  return undefined;
}

export async function applyWHFSObjectUpdates(targetObject: WHFSObject, body: TypedRestRequest<AuthorizedWRDAPIUser, "patch /whfs/object">["body"]) {
  const importOptions: ImportOptions = {
    unmapWhfsLink: ref => unmapWhfsLink(targetObject, ref)
  };

  const virtualMetadata = body.instances?.find(_ => _.whfsType === "platform:virtual.objectdata")?.data;
  if (virtualMetadata) {
    const updates = await mapVirtualMetaData(targetObject, virtualMetadata, importOptions);
    if (updates) { //TODO how about instance only updates ... they should update lastmod time too?
      await targetObject.update(updates);
    }
  }
  await applyInstanceUpdates(targetObject, body.instances, importOptions);

}

export async function updateWHFSObject(req: TypedRestRequest<AuthorizedWRDAPIUser, "patch /whfs/object">): Promise<OpenAPIResponse> {
  try {
    const targetObject = await resolvePath(req);
    return await runInWork(async () => {
      await applyWHFSObjectUpdates(targetObject, req.body);
      return req.createJSONResponse(200, {});
    });
  } catch (e) {
    if (e instanceof WHFSAPIError) {
      return req.createErrorResponse(e.statusCode, { error: e.message });
    }
    throw e;
  }
}
