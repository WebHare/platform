/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import backendrpc from "@mod-consilio/js/internal/backend.rpc.json?proxy";
import * as dompack from 'dompack';

export default class ConsilioBackend {
  constructor(consiliotoken) {
    this._consiliotoken = consiliotoken;
  }

  //request autosuggestions. asking for new autosuggestions will abort any running call
  getSuggestions(words) {
    if (this._currentresolve) //if we need to "abort" previous calls...
      this._currentresolve(null);

    const defer = Promise.withResolvers();
    this._currentresolve = defer.resolve;
    backendrpc.autoSuggest(this._consiliotoken, words).then(response => {
      defer.resolve(response.suggestions);
      this._currentresolve = null;
    });
    return defer.promise;
  }
}
