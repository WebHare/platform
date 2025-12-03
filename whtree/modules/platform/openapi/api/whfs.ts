import type { TypedRestRequest } from "@mod-platform/generated/openapi/platform/api";
import type { AuthorizedWRDAPIUser, HTTPSuccessCode, OpenAPIResponse, OpenAPIResponseType } from "@webhare/openapi-service";
import { getAuthorizationInterface } from "@webhare/auth";
import { listInstances, openFileOrFolder, whfsType, type WHFSFile, type WHFSObject } from "@webhare/whfs";
import type { FileTypeInfo } from "@webhare/whfs/src/contenttypes";

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

async function getInstances(obj: WHFSObject) {
  const typeinfo = await obj.describeType();
  const instanceList: OpenAPIResponseType<TypedRestRequest<AuthorizedWRDAPIUser, "get /whfs/object">, HTTPSuccessCode.Ok>["instances"] = [
    {
      whfsType: 'platform:virtual.objectdata',
      clone: 'onCopy',
      data: {
        title: obj.title,
        description: obj.description,
        ...obj.isFile ? { keywords: (obj as WHFSFile).keywords } : {},
        ...obj.isFile && (typeinfo as FileTypeInfo).hasData ? { data: (obj as WHFSFile).data } : {},
      }
    }
  ];

  const instances = await listInstances(obj.id);
  for (const instance of instances) {
    if (instance.orphan)
      continue;

    const data = await whfsType(instance.scopedType || instance.namespace).get(obj.id, { export: true, exportResources: "fetch" });
    instanceList.push({
      whfsType: instance.scopedType || instance.namespace,
      clone: instance.clone,
      data: data || {}
    });
  }

  return instanceList;
}

export async function getWHFSObject(req: TypedRestRequest<AuthorizedWRDAPIUser, "get /whfs/object">): Promise<OpenAPIResponse> {
  try {
    const targetObj = await resolvePath(req);
    const reuslt: OpenAPIResponseType<typeof req, HTTPSuccessCode.Ok> = {
      name: targetObj.name,
      whfsPath: targetObj.whfsPath,
      modified: targetObj.modified.toString(),
      type: targetObj.type,
      ...(targetObj.isFolder ? { isFolder: true } : {}),
    };

    if (targetObj.isFolder && req.params.children === true) {
      reuslt.children = (await targetObj.list(["modified", "type"])).map(item => ({
        name: item.name,
        whfsPath: targetObj.whfsPath + item.name + (item.isFolder ? "/" : ""),
        modified: item.modified.toString(),
        type: item.type,
        ...item.isFolder ? { isFolder: true } : {}
      }));
    }
    if (req.params.instances) {
      if (req.params.instances !== "*")
        return req.createErrorResponse(400, { error: "instances parameter must be '*' if set" });

      reuslt.instances = await getInstances(targetObj);
    }

    return req.createJSONResponse(200, reuslt);
  } catch (e) {
    if (e instanceof WHFSAPIError) {
      return req.createErrorResponse(e.statusCode, { error: e.message });
    }
    throw e;
  }
}
