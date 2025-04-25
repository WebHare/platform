import { createWebResponse, type WebRequest, type WebResponse } from "@webhare/router";

export async function devkitRouter(req: WebRequest): Promise<WebResponse> {
  switch (req.localPath.split("/")[0]) {
    case "instant-swagger": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (require("./swagger")).instantSwagger(req); //split to avoid loading the whole swagger bundle for all /wh-devkit URLs
    }
  }
  return createWebResponse("", { status: 404 });
}
