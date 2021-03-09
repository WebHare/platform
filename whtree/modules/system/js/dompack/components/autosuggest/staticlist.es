import { normalizeSelectValues } from './index.es';

export default class StaticSuggestionList
{
  constructor(list, options)
  {
    this._casesensitive = options && options.casesensitive;
    this._list = normalizeSelectValues(list);
  }
  async lookup(word)
  {
    let outlist = [];
    if(!this._casesensitive)
      word = word.toLowerCase();

    for(let entry of this._list)
    {
      if(this._casesensitive ? entry.value.startsWith(word) : entry.value.toLowerCase().startsWith(word))
        outlist.push(entry);
    }

    return outlist;
  }
}
