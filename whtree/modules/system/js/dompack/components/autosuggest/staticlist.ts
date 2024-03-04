/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import { normalizeSelectValues } from './index';

export default class StaticSuggestionList {
  constructor(list, options?) {
    this._casesensitive = options && options.casesensitive;
    this._list = normalizeSelectValues(list);
  }
  async lookup(word) {
    const outlist = [];
    if (!this._casesensitive)
      word = word.toLowerCase();

    for (const entry of this._list) {
      if (this._casesensitive ? entry.value.startsWith(word) : entry.value.toLowerCase().startsWith(word))
        outlist.push(entry);
    }

    return outlist;
  }
}
