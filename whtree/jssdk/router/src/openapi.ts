import type Ajv from 'ajv';
import type { OpenAPIV3 } from 'openapi-types';

export type WebHareOpenApiAdditions = {
  "x-webhare-implementation"?: string;
  "x-webhare-authorization"?: string;
};

export interface WebHareOpenApiPathItem extends OpenAPIV3.PathItemObject<WebHareOpenApiAdditions> {
  "x-webhare-authorization"?: string;
}

export interface WebHareOpenAPIDocument extends OpenAPIV3.Document<WebHareOpenApiAdditions> {
  "x-webhare-authorization"?: string;
  "x-webhare-default-error-mapper"?: string;
}

/** Describes the currently loading OpenAPI documentation */
export interface OpenAPIServiceInitializationContext {
  /** Full service name (module:openapi) */
  name: string;
  /** Parsed YAML specification (includes any merges but before the bundling step) */
  spec: WebHareOpenAPIDocument;
  /** Swagger rendering options overrides */
  swaggerOptions: object;
  /** Signal that will be aborted when the service is invalidated */
  signal: AbortSignal;
}

/** Describes the currently loading OpenAPI documentation */
export interface OpenAPIHandlerInitializationContext {
  /** Full service name (module:openapi) */
  name: string;
  /** Ajv validator used for incoming and outgoing data */
  ajv: Ajv;
}
