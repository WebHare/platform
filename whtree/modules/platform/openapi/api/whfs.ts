import type { TypedRestRequest } from "@mod-platform/generated/openapi/platform/api";
import type { AuthorizedWRDAPIUser, HTTPSuccessCode, OpenAPIResponse, OpenAPIResponseType } from "@webhare/openapi-service";
import { getAuthorizationInterface } from "@webhare/auth";
import { listInstances, openFile, openFileOrFolder, whfsType, type WHFSFile, type WHFSObject } from "@webhare/whfs";
import type { FileTypeInfo } from "@webhare/whfs/src/contenttypes";
import { runInWork } from "@webhare/whdb";
import { getType } from "@webhare/whfs/src/describe";
import type { ExportResourcesOptions } from "@webhare/services/src/descriptor";

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

async function getInstances(obj: WHFSObject, exportResources: ExportResourcesOptions) {
  const typeinfo = await obj.describeType();
  const instanceList: OpenAPIResponseType<TypedRestRequest<AuthorizedWRDAPIUser, "get /whfs/object">, HTTPSuccessCode.Ok>["instances"] = [
    {
      whfsType: 'platform:virtual.objectdata',
      clone: 'onCopy',
      data: {
        title: obj.title,
        description: obj.description,
        ...obj.isUnlisted ? { isUnlisted: true } : {},
        ...obj.isFile ? { keywords: (obj as WHFSFile).keywords } : {},
        ...obj.isFile && (typeinfo as FileTypeInfo).hasData ? { data: (obj as WHFSFile).data } : {},
        ...obj.isFile && (typeinfo as FileTypeInfo).isPublishable ? { publish: (obj as WHFSFile).publish } : {},
        ...obj.isFolder && obj.indexDoc ? { indexDoc: (await openFile(obj.indexDoc)).name } : {},
      }
    }
  ];

  const instances = await listInstances(obj.id);
  for (const instance of instances) {
    if (instance.orphan)
      continue;

    const data = await whfsType(instance.scopedType || instance.namespace).get(obj.id, { export: true, exportResources });
    instanceList.push({
      whfsType: instance.scopedType || instance.namespace,
      clone: instance.clone,
      data: data || {}
    });
  }

  return instanceList;
}

export async function exportWHSFObject(targetObj: WHFSObject, instances: string, exportResources: ExportResourcesOptions): Promise<OpenAPIResponseType<TypedRestRequest<AuthorizedWRDAPIUser, "get /whfs/object">, HTTPSuccessCode.Ok>> {
  const result: OpenAPIResponseType<TypedRestRequest<AuthorizedWRDAPIUser, "get /whfs/object">, HTTPSuccessCode.Ok> = {
    name: targetObj.name,
    whfsPath: targetObj.whfsPath,
    modified: targetObj.modified.toString(),
    type: targetObj.type,
    ...(targetObj.isFolder ? { isFolder: true } : {}),
    ...(targetObj.link ? { link: targetObj.link } : {})
  };

  if (instances) {
    result.instances = await getInstances(targetObj, exportResources);
  }
  return result;
}

export async function getWHFSObject(req: TypedRestRequest<AuthorizedWRDAPIUser, "get /whfs/object">): Promise<OpenAPIResponse> {
  try {
    if (req.params.instances && req.params.instances !== "*")
      return req.createErrorResponse(400, { error: "instances parameter must be '*' if set" });

    const targetObj = await resolvePath(req);
    const result = await exportWHSFObject(targetObj, req.params.instances || '', "fetch");
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

async function mapVirtualMetaData(target: WHFSObject | null, data: Record<string, unknown>): Promise<{
  title?: string;
  description?: string;
  keywords?: string;
  isUnlisted?: boolean;
  publish?: boolean;
  type?: string;
  indexDoc?: number | null;
} | null> {

  const retval: Awaited<ReturnType<typeof mapVirtualMetaData>> = {};
  for (const key of Object.keys(data)) {
    switch (key) {
      case "title":
      case "description":
      case "keywords":
      case "type":
        if (typeof data[key] !== "string")
          throw new WHFSAPIError(`Invalid virtual metadata: '${key}' must be a string`, 400);
        retval[key] = data[key] as string;
        break;
      case "indexDoc":
        if (typeof data.indexDoc !== "string")
          throw new WHFSAPIError(`Invalid virtual metadata: 'indexDoc' must be a string or null`, 400);
        else if (!data.indexDoc)
          retval.indexDoc = null;
        else {
          if (!target?.isFolder)
            throw new WHFSAPIError(`Invalid virtual metadata: 'indexDoc' can only be set on (existing) folders`, 400);
          const targetDoc = await target.openFile(data.indexDoc as string, { allowMissing: true });
          if (!targetDoc)
            throw new WHFSAPIError(`Invalid virtual metadata: indexDoc file ${data.indexDoc}' not found`, 400);
          retval.indexDoc = targetDoc.id;
        }
        break;
      case "isUnlisted":
      case "publish":
        if (typeof data[key] !== "boolean")
          throw new WHFSAPIError(`Invalid virtual metadata: '${key}' must be a boolean`, 400);
        retval[key] = data[key] as boolean;
        break;
      default:
        throw new WHFSAPIError(`Invalid virtual metadata: unknown property '${key}'`, 400);
    }
  }
  return Object.keys(retval).length > 0 ? retval : null;
}

async function applyInstanceUpdates(obj: WHFSObject, instances: TypedRestRequest<AuthorizedWRDAPIUser, "post /whfs/object">["body"]["instances"]) {
  for (const instance of instances || []) {
    if (instance.whfsType === "platform:virtual.objectdata")
      continue;
    const typeHandler = whfsType(instance.whfsType);
    await typeHandler.set(obj.id, instance.data as object || {});
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

export async function applyWHFSObjectUpdates(targetObject: WHFSObject, body: TypedRestRequest<AuthorizedWRDAPIUser, "patch /whfs/object">["body"]) {
  const virtualMetadata = body.instances?.find(_ => _.whfsType === "platform:virtual.objectdata")?.data;
  if (virtualMetadata) {
    const updates = await mapVirtualMetaData(targetObject, virtualMetadata);
    if (updates) { //TODO how about instance only updates ... they should update lastmod time too?
      await targetObject.update(updates);
    }
  }
  await applyInstanceUpdates(targetObject, body.instances);

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
