/** Library to connect to WebHare-based and external OpenAPI services */

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/openapi-client" {
}

import { TypedOpenAPIClient } from "@mod-system/js/internal/openapi/openapitypedclient";
import type { OpenAPIClientFetch } from "@webhare/openapi-service";

import type { OpenAPIClientDefinitions } from "@mod-platform/generated/ts/openapi.ts";
// @ts-ignore -- this file is only accessible when this is file loaded from a module (not from the platform tsconfig)
import type { } from "wh:ts/openapi.ts";

interface OpenAPIClientOptions {
  bearerToken?: string;
}

export function createOpenAPIClient<ClientType extends keyof OpenAPIClientDefinitions>(spec: ClientType, options?: OpenAPIClientOptions): OpenAPIClientDefinitions[ClientType];
export function createOpenAPIClient<ClientType extends keyof OpenAPIClientDefinitions>(service: string | OpenAPIClientFetch, options?: OpenAPIClientOptions): OpenAPIClientDefinitions[ClientType];

export function createOpenAPIClient<ClientType extends keyof OpenAPIClientDefinitions>(specOrService: ClientType | string | OpenAPIClientFetch, options?: OpenAPIClientOptions): OpenAPIClientDefinitions[ClientType] {
  return new TypedOpenAPIClient(specOrService, options) as OpenAPIClientDefinitions[ClientType];
}
