import { normalizeSelectValues } from './index';

export default class StaticSuggestionList {
  _casesensitive: boolean;
  _list: Array<{ value: string }>;

  constructor(list: Array<string | { value: string }>, options?: { casesensitive?: boolean }) {
    this._casesensitive = Boolean(options && options.casesensitive);
    this._list = normalizeSelectValues(list);
  }
  async lookup(word: string) {
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
