// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/router" {
}

import type { WRDAuthPluginAPI } from '@mod-wrd/js/internal/wrdauthplugin';
import type { WebRequest } from './request';
import type { WebResponse } from './response';
import type { ContentPageRequest } from './siterequest';

export interface WebdesignPluginAPIs {
  "platform:wrdauth": WRDAuthPluginAPI;
}

export { HTTPMethod, getOriginURL, expandCookies, type WebRequest, type RPCContext, type RPCAPI, type RPCFilter } from './request';
export {
  createWebResponse, createJSONResponse, createRedirectResponse, HTTPErrorCode, HTTPSuccessCode, RPCError,
  type WebResponse, type HTTPStatusCode, type HTTPRedirectCode, type RPCErrorCodes
} from './response';
export type { WebDesignFunction, SiteRequest, ResponseBuilder, PageBuildRequest, PagePartRequest, ContentBuilderFunction, PagePluginRequest, PagePluginFunction } from './siterequest';
export {
  RestRequest
} from './restrequest';
export type { DefaultRestParams, RestSuccessfulAuthorization, RestFailedAuthorization, RestAuthorizationResult, RestImplementationFunction, RestAuthorizationFunction, RestDefaultErrorMapperFunction, RestResponseType, RestDefaultErrorBody } from './restrequest';
export { getAssetPackIntegrationCode } from "./concepts";
export { SiteResponse, SiteResponseSettings } from "./sitereponse";
export { type WebHareOpenAPIDocument, type OpenAPIServiceInitializationContext } from "./openapi";

export type WebHareRouter = (request: WebRequest) => Promise<WebResponse>;
export type { ContentPageRequest };
