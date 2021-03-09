import * as dompack from "../../src/index.es";
import SelectList from "../internal/selectlist.es";
import KeyboardHandler from '../../extra/keyboard.es';

export function normalizeSelectValues(values)
{
  let outvalues = [];
  for(let val of values)
  {
    if(typeof val == "string")
      val = { value:val };
    outvalues.push(val);
  }
  return outvalues;
}

export default class AutoSuggest extends SelectList
{
  /** options.fixitemswidth Make the items container as wide as the pulldown. Defaults to true */
  constructor(node, getsuggestions, options)
  {
    super(options);
    this._node = node;
    this._anchornode = this._node;
    this._getsuggestions = getsuggestions;

    this._lookuppending = false;
    this._lookuphistory = [];
    this._lookuplock = null;
    this._dontresuggest = false;

    this.options = { noresultstext: ''
                   , minlength: 3
                   , immediateresuggest: false //immediately resuggest
                   , suggestdelay: 200 //how long to wait before we initiate suggestions
                   , triminput: true
                   , ...options
                   };

    this._node.addEventListener("input", () => this._onInput());
    this._node.addEventListener("focus", evt => this._onFocus(evt));
    this._node.addEventListener("blur", evt => this._onBlur(evt));

    new KeyboardHandler(this._node, { /*"Escape": evt => this.removeSuggestions()
                                    ,*/ "ArrowDown": evt => this._onArrowDown()
                                    }, { captureunsafekeys:true
                                       });
  }

  _onFocus()
  {
    if(this.options.minlength == 0 && this._getCurrentInput().length == 0)
      this._onInput();
  }

  _onArrowDown()
  {
    //ADDME should we do something like speed up the updatetimer if it's not here yet?
    if(!this._isOpen())
      return;

    this._items.focus();
  }

  _onInput()
  {
    if(this._lookuppending || this._dontresuggest || this._node.disabled || this._node.readOnly)
      return;

    if(!this._lookuplock)
    {
      this._lookuplock = dompack.flagUIBusy();
      this._node.classList.add(this._class + "--autosuggesting");
    }

    if( this._updatetimer )
      clearTimeout(this._updatetimer);

    this._updatetimer = setTimeout(() => this._checkInput(), this.options.suggestdelay);
  }
  _endLock()
  {
    if(this._lookuplock)
    {
      this._lookuplock.release();
      this._lookuplock = null;
      this._node.classList.remove(this._class + "--autosuggesting");
    }
  }
  _onBlur()
  {
    if(this._updatetimer)
    {
      clearTimeout(this._updatetimer);
      this._updatetimer = 0;
    }
    this._endLock();
    this.closeSelectList();
  }
  _safeToSuggest(value)
  {
    if(value.length < this.options.minlength) //FIXME count last word, not full string
      return false;

    return true;
  }
  _getCurrentInput()
  {
    let input = this._node.value;
    if(this.options.triminput)
      input = input.trim();
    return input;
  }
  async _lookup(input)
  {
    let historyhit = this._lookuphistory.find(entry => entry.input == input);
    if(historyhit)
      return historyhit.values;

    this._lookuppending = true;

    let lookupresult;
    if(typeof this._getsuggestions == "function")
    {
      lookupresult = await Promise.resolve(this._getsuggestions(input));
    }
    else
    {
      lookupresult = await Promise.resolve(this._getsuggestions.lookup(input));
    }

    this._lookuphistory.push({ input: input, values: lookupresult });
    this._lookuppending = false;
    return lookupresult;
  }
  async _checkInput()
  {
    try
    {
      await this._offerSuggestions();
    }
    finally
    {
      this._endLock();
    }
  }

  async _offerSuggestions()
  {
    let input, values;
    do //loop until what we looked up matches what we were looking for
    {
      input = this._getCurrentInput();
      if(!this._safeToSuggest(input))
        return;

      values = await this._lookup(input);
    } while(input != this._getCurrentInput());

    if(!values || values.length == 0)
    {
      if(this._items)
        this.closeSelectList();
      return;
    }

    this._generateItems({values});
    document.body.appendChild(this._items); //throw it in the dom so we can measure it
    this._openSelectList();
  }

  _generateItemNodes(options)
  {
    let newitems = document.createDocumentFragment();
    for(let val of normalizeSelectValues(options.values))
    {
      let node = dompack.create('div', { className: this._class + '__item' + ' '
                                                    + (val.className || '')
                                       , dataset: val.dataset || null
                                       });

      let value = dompack.create("span", { className: this._class + '__itemvalue'
                                         , textContent: val.value || '\u00a0'
                                         });
      node.appendChild(value);

      if(val.append)
      {
        let value = dompack.create("span", { className: this._class + '__itemappend'
                                           , textContent: val.append
                                           });
        node.appendChild(value);
      }

      newitems.appendChild(node);
    }
    this._items.appendChild(newitems);
  }

  _doSelectItem(selectitem)
  {
    let selectedvalue = selectitem.querySelector('.' + this._class + '__itemvalue').textContent;
    //if dompack:autosuggest-selected, we don't replace the input value
    if(!dompack.dispatchCustomEvent(this._node
                                    , 'dompack:autosuggest-selected'
                                    , { bubbles: true
                                      , cancelable: true
                                      , detail: { autosuggester: this, value: selectedvalue }
                                      }))
    {
      return;
    }

    this._node.value = selectedvalue;
    if(!this.options.immediateresuggest) //prevent us from immediately processing our own input event
      this._dontresuggest = true;
    dompack.fireModifiedEvents(this._node);
    this._dontresuggest = false;
    return true;
  }

  closeSelectList()
  {
    super.closeSelectList();
    if(this._items)
      dompack.remove(this._items);
  }
}
