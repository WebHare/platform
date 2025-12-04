import { type OpenAPIResponse, HTTPSuccessCode, type OpenAPIRequest, type OpenAPIServiceInitializationContext, type OpenAPIHandlerInitializationContext } from "@webhare/openapi-service";
import { signalOnEvent } from "@webhare/services";
import * as test from "@webhare/test";

export async function getExtensionCall(req: OpenAPIRequest): Promise<OpenAPIResponse> {
  test.eq('/extension', req.path);
  return req.createJSONResponse(HTTPSuccessCode.Ok, { message: "I have been extended" });
}

export async function postExtensionCall(req: OpenAPIRequest): Promise<OpenAPIResponse> {
  test.eq('/extension', req.path);
  return req.createJSONResponse(HTTPSuccessCode.Ok, req.body);
}

const scriptUuid = crypto.randomUUID();

export async function extendTheService(context: OpenAPIServiceInitializationContext) {
  test.eq("webhare_testsuite:extendedservice", context.name);
  (context.spec as any)["x-webhare_testsuite-randomuuid"] = crypto.randomUUID();
  (context.spec as any)["x-webhare_testsuite-scriptuuid"] = scriptUuid;

  context.spec.paths["/extension"] = {
    get: {
      description: "I have been extended",
      responses: {
        200: {
          description: "OK"
        }
      },
      "x-webhare-implementation": "@mod-webhare_testsuite/tests/wh/webserver/remoting/openapi/hooks.ts#getExtensionCall"
    },
    post: {
      description: "I have been extended and use a dynamically registered format",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                checkedAtInput: {
                  type: "string",
                  format: "wh-testfw-extformat"
                },
                checkedAtOutput: {
                  type: "string"
                }
              }
            }
          }
        }
      },
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  checkedAtInput: {
                    type: "string"
                  },
                  checkedAtOutput: {
                    type: "string",
                    format: "wh-testfw-extformat"
                  }
                }
              }
            }
          }
        }
      },
      "x-webhare-implementation": "@mod-webhare_testsuite/tests/wh/webserver/remoting/openapi/hooks.ts#postExtensionCall"
    }
  };
  return { signal: await signalOnEvent("webhare_testsuite:invalidateopenapiextendedservice") };
}

export function extendTheHandler(context: OpenAPIHandlerInitializationContext) {
  // Adds format 'wh-testfw-extformat' to the AJV checker used for input and output validation
  test.eq("webhare_testsuite:extendedservice", context.name);
  context.ajv.addFormat("wh-testfw-extformat", {
    type: "string",
    validate: /^testfw-/
  });
}
