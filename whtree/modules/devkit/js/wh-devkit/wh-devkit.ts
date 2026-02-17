import { createWebResponse, type WebRequest, type WebResponse } from "@webhare/router";
import { openBackendService } from "@webhare/services/src/backendservice";

type ResourceRef = {
  col: number;
  filename: string;
  func: string;
  line: number;
};

export async function devkitRouter(req: WebRequest): Promise<WebResponse> {
  switch (req.localPath.split("/")[0]) {
    case "instant-swagger": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (require("./swagger")).instantSwagger(req); //split to avoid loading the whole swagger bundle for all /wh-devkit URLs
    }
    case "flags": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (require("./flags")).handleFlags(req);
    }
    case "openineditor": {
      await using service = await openBackendService("devkit:lspservice", undefined, { linger: false, timeout: 5000 });
      const openParam = JSON.parse(new URL(req.url).searchParams.get("open") ?? "{}") as ResourceRef;
      await service.showResource({ resource: openParam.filename, line: openParam.line, col: openParam.col });
      return createWebResponse("", { status: 204 });
    }
  }
  return createWebResponse("", { status: 404 });
}
