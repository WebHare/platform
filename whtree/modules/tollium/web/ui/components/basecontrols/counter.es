import * as dompack from "dompack";
import { getUTF8Length, limitUTF8Length } from "@mod-system/js/internal/utf8";
import "./counter.css";


export class Counter
{
  /** @param options
      @cell options.count
      @cell options.limit
      @cell options.separator
      @cell options.cssclass Extra css class to add to the root node
      @cell options.focusnode Node containing the node we're listeining to and to whose focus events we should watch (simulating css focus-in)
  */
  constructor(options)
  {
    this._options = options || {};

    this._buildNode();
    this._updateState();
    this.focusnode = options.focusnode;

    options.focusnode.addEventListener("focusin", evt => this._onFocusInOut(true, evt));
    options.focusnode.addEventListener("focusout", evt => this._onFocusInOut(false, evt));
  }

  _onFocusInOut(isfocusin, event)
  {
    if( this.focusnode.contains(event.target) && this.focusnode.contains(event.relatedTarget))
      return; //intra-focus event, ignore;

    this.node.classList.toggle("wh-counter--hasfocus", isfocusin);
  }

  _buildNode()
  {
    this.node = dompack.create("div", { className: "wh-counter", childNodes:
        [ this._countnode = dompack.create("span", { className: "wh-counter__count" })
        , this._separatornode = dompack.create("span", { className: "wh-counter__separator" })
        , this._limitnode = dompack.create("span", { className: "wh-counter__limit" })
        ] });
  }

  _updateState()
  {
    let classes =
      { "wh-counter--havelimit":    this._options.limit
      , "wh-counter--limitreached": this._options.limit && this._options.count >= this._options.limit
      , "wh-counter--overflow":     this._options.limit && this._options.count > this._options.limit
      };

    if (this._options.cssclass)
      classes[this._options.cssclass] = true;

    dompack.toggleClasses(this.node, classes);
    this._countnode.textContent = this._options.count || 0;
    if (this._options.limit)
    {
      this._separatornode.textContent = this.separator || "/";
      this._limitnode.textContent = this._options.limit;
      this._separatornode.style.display = "";
      this._limitnode.style.display = "";
    }
    else
    {
      this._separatornode.style.display = "none";
      this._limitnode.style.display = "none";
    }
  }

  /** @param updates
      @cell(integer) updates.count
      @cell(integer) updates.limit
  */
  update(updates)
  {
    Object.assign(this._options, updates);
    this._updateState();
  }
}

export class InputTextLengthCounter
{
  // node
  // _options
  // _input
  // _counter
  // _limit

  constructor(node, options)
  {
    this._options = Object.assign(
        { showcounter:        true
        , forcelimit:         true          //concat text to given max length
        , input:              null          //input to count
        , separator:          "/"
        , cssclass:           ""            //additional css class
        , maxlengthmeasure:   "characters" // characters or bytes
        }, options || {});

    this.node = node;

    this._input = this._options.input || node.querySelector("input,textarea");
    if (!this._input)
      throw new Error("Could not locate input node to count");

    this._limit = Number(this._input.maxLength);
    if (this._options.showcounter)
    {
      this._counter = new Counter(
          { count:        this._getTextlength()
          , limit:        this._limit
          , separator:    this._options.separator
          , cssclass:     this._options.cssclass
          , focusnode:    this._input
          });

      this.node.appendChild(this._counter.node);
    }

    //use keyup event because of behavour of IE
    this._input.addEventListener("keydown", () => this.update());
    this._input.addEventListener("input", () => this.update());
  }

  _getTextlength()
  {
    return (this._options.maxlengthmeasure === "bytes"
        ? getUTF8Length(this._input.value)
        : this._input.value.length);
  }

  update()
  {
    this._limit = Number(this._input.maxLength);

    let updates =
        { count:  this._getTextlength()
        , limit:  this._limit
        };

    if (this._limit > 0 && updates.count > this._limit && this._options.forcelimit)
    {
      var inptext = this._input.value;
      if (this._options.maxlengthmeasure === "bytes")
        inptext = limitUTF8Length(inptext, this._limit);
      else
        inptext = inptext.substring(0, this._limit);

      this._input.value = inptext;
      updates.count = this._getTextlength();
    }

    if (this._counter)
      this._counter.update(updates);
  }
}
