/** Library to connect to WebHare-based and external OpenAPI services */

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/openapi-client" {
}

import { TypedOpenAPIClient } from "./typedclient";
import type { OpenAPIClientFetch } from "@webhare/openapi-service";

import type { OpenAPIClientDefinitions } from "@mod-platform/generated/ts/openapi.ts";
// @ts-ignore -- this file is only accessible when this is file loaded from a module (not from the platform tsconfig)
import type { } from "wh:ts/openapi.ts";

interface OpenAPIClientOptions {
  bearerToken?: string;
}

/** Create an typed openapi client either by URL or a 'fetch' callback. You can use a getDirectOpenAPIFetch to directly access a local service in-process (giving you better stacktraces and console logging)
 * @typeParam ClientType - The `module:client` type to create. Refers to an openAPIClient in the moduledefinition.yml
 * @param urlOrFetch - The URL of the service to connect to or a fetch call to use to connect to it.
 */
export function createOpenAPIClient<ClientType extends keyof OpenAPIClientDefinitions>(urlOrFetch: string | OpenAPIClientFetch, options?: OpenAPIClientOptions): OpenAPIClientDefinitions[ClientType] {
  return new TypedOpenAPIClient(urlOrFetch, options) as OpenAPIClientDefinitions[ClientType];
}
