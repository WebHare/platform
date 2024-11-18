import * as dompack from "@webhare/dompack";
import { getUTF8Length, limitUTF8Length } from "@mod-system/js/internal/utf8";
import "./counter.css";
import { throwError } from "@webhare/std";

interface CounterOptions {
  lengthmeasure: "characters" | "bytes";
  required: boolean;
  //FIXME avoid raw styling
  style: string | null;
  focusnode: HTMLElement;
  count: number;
  limit: number;
  minvalue: number;
  separator: string;
}

interface InputTextLengthCounterOptions {
  inputnode: HTMLInputElement | HTMLTextAreaElement;
  lengthmeasure: "characters" | "bytes";
  //FIXME avoid raw styling
  style: string | null;
  required: boolean;
}

export class Counter {
  node;
  focusnode: HTMLElement;
  _countnode;
  _separatornode;
  _limitnode;
  _options: CounterOptions;

  /** @param options -
       count
       required
       minvalue
       limit
       separator
       cssclass Extra css class to add to the root node
       focusnode Node containing the node we're listeining to and to whose focus events we should watch (simulating css focus-in)
  */
  constructor(options: Partial<CounterOptions> & Pick<CounterOptions, "focusnode">) {
    this._options = { minvalue: -1, limit: -1, required: false, separator: '/', lengthmeasure: "characters", style: null, count: 0, ...options };

    this.node = dompack.create("div", {
      className: "wh-counter", childNodes:
        [
          this._countnode = dompack.create("span", { className: "wh-counter__count" }),
          this._separatornode = dompack.create("span", { className: "wh-counter__separator" }),
          this._limitnode = dompack.create("span", { className: "wh-counter__limit" })
        ]
    });

    this._updateState();
    this.focusnode = options.focusnode || throwError("No focusnode provided");

    //FIXME can't we replace this with focus-within stuff ?
    dompack.addDocEventListener(this.focusnode, "focusin", evt => this._onFocusInOut(true, evt));
    dompack.addDocEventListener(this.focusnode, "focusout", evt => this._onFocusInOut(false, evt));
  }

  _onFocusInOut(isfocusin: boolean, event: dompack.DocEvent<FocusEvent>) {
    if (this.focusnode.contains(event.target) && this.focusnode.contains(event.relatedTarget))
      return; //intra-focus event, ignore;

    this.node.classList.toggle("wh-counter--hasfocus", isfocusin);
  }

  _updateState() {
    this.node.classList.toggle("wh-counter--havelimit", this._options.limit >= 0);
    this.node.classList.toggle("wh-counter--haveminvalue", this._options.minvalue >= 0);
    this.node.classList.toggle("wh-counter--limitreached", this._options.limit >= 0 && this._options.count >= this._options.limit);
    this.node.classList.toggle("wh-counter--underflow", Boolean((this._options.required || this._options.count) && this._options.minvalue >= 0 && this._options.count < this._options.minvalue));
    this.node.classList.toggle("wh-counter--overflow", this._options.limit >= 0 && this._options.count > this._options.limit);

    this._countnode.textContent = String(this._options.count || 0);
    if (this._options.minvalue >= 0 || this._options.limit >= 0) {
      this._separatornode.textContent = this._options.separator;
      this._limitnode.textContent = String(this._options.minvalue >= 0
        ? this._options.limit >= 0
          ? `${this._options.minvalue} - ${this._options.limit}`
          : `${this._options.minvalue}+`
        : this._options.limit);
      this._separatornode.style.display = "";
      this._limitnode.style.display = "";
    } else {
      this._separatornode.style.display = "none";
      this._limitnode.style.display = "none";
    }

    //@ts-expect-error FIXME directly assigning style is dangerous and actually readonly?. keeping this for now as it was already htere...
    this.node.style = this._options.style || "";
  }

  /** @param update - update options
           updates.count
           updates.limit
  */
  update(updates: Partial<CounterOptions>) {
    Object.assign(this._options, updates);
    this._updateState();
  }
}

export class InputTextLengthCounter {
  node;
  _options;
  _input: HTMLInputElement | HTMLTextAreaElement;
  _counter;
  _minlength;
  _limit;

  constructor(node: HTMLElement, options?: Partial<InputTextLengthCounterOptions>) {
    this._options = {
      showcounter: true,
      forcelimit: true,          //concat text to given max length
      input: null,          //input to count
      separator: "/",
      cssclass: "",            //additional css class
      lengthmeasure: "characters", // characters or bytes
      style: "",
      required: false,
      ...options || {}
    };

    this.node = node;

    this._input = this._options.input || dompack.qR(node, "input,textarea");

    this._minlength = Number(this._input.minLength);
    this._limit = Number(this._input.maxLength);

    this._counter = new Counter(
      {
        count: this._getTextlength(),
        required: this._input.required || this._options.required,
        minvalue: this._minlength,
        limit: this._limit,
        separator: this._options.separator,
        focusnode: this._input,
        style: this._options.style
      });

    this.node?.appendChild(this._counter.node);

    //use keyup event because of behavour of IE
    this._input.addEventListener("keydown", () => this.update());
    this._input.addEventListener("input", () => this.update());
  }

  getNode() {
    return this._counter.node;
  }

  _getTextlength() {
    return (this._options.lengthmeasure === "bytes"
      ? getUTF8Length(this._input.value)
      : this._input.value.length);
  }

  update(updateoptions = {}) {
    Object.assign(this._options, updateoptions);

    this._minlength = Number(this._input.minLength);
    this._limit = Number(this._input.maxLength);

    const updates =
    {
      required: this._input.required || this._options.required,
      count: this._getTextlength(),
      minvalue: this._minlength,
      limit: this._limit
    };

    if (this._limit > 0 && updates.count > this._limit && this._options.forcelimit) {
      let inptext = this._input.value;
      if (this._options.lengthmeasure === "bytes")
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
