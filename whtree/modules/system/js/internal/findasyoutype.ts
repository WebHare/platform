import * as dompack from '@webhare/dompack';

export default class FindAsYouType {
  findingasyoutype: { timeout: NodeJS.Timeout | 0; search: string } | null = null;
  findasyoutyperegex = null;
  searchtimeout = 0;
  onsearch;
  node;

  constructor(node: HTMLElement, options: { searchtimeout?: number; onsearch: (search: string) => void }) {
    if (options?.searchtimeout)
      this.searchtimeout = options.searchtimeout;
    this.onsearch = options.onsearch;

    this.node = node;
    node.addEventListener("keydown", this._onKeyboard);
    node.addEventListener("focusout", this._onFocusOut);
  }

  _onKeyboard = (evt: KeyboardEvent) => {
    if (evt.target !== this.node)
      return; //ignore keyboard events to embedded elements (eg inline title changes in lists)
    switch (evt.key) {
      case "Escape":
        if (this.findingasyoutype) {
          dompack.stop(evt);
          this.stop();
        }
        break;
      case "Backspace":
        dompack.stop(evt);
        if (this.findingasyoutype)
          this._updateFindAsYouType(null);
        break;
      default:
        if (evt.key.length === 1 && !(evt.altKey || evt.ctrlKey || evt.metaKey)) { //normal key, add it to the search
          dompack.stop(evt);
          this._updateFindAsYouType(evt.key);
        } //don't cancel ourselves based on 'odd key press'. just have focus loss deal with the effect of eg ctrl+shift+2
    } //end switch
  };

  _updateFindAsYouType(toadd: string | null) {
    // If we're already searching, clear the current deactivation timeout
    if (this.findingasyoutype) {
      if (this.findingasyoutype.timeout)
        clearTimeout(this.findingasyoutype.timeout);
    } else {
      // Activate search
      this.findingasyoutype = {
        timeout: 0, //deactivation timeout
        search: "" //currently searching for this string
      };
    }

    // If a backspace was pressed, delete the last character, otherwise add the pressed character to the search string
    if (toadd === null) //backspace
      this.findingasyoutype.search = this.findingasyoutype.search.substr(0, this.findingasyoutype.search.length - 1);
    else
      this.findingasyoutype.search += toadd;

    // If we still have a search string, set the deactivation timeout, otherwise deactivate directly
    if (this.findingasyoutype.search.length) {
      if (this.searchtimeout)
        this.findingasyoutype.timeout = setTimeout(() => this.stop(), this.searchtimeout);

      // Create a regular expression matching string beginning with the (escaped) search string, ignoring case
      this.onsearch(this.findingasyoutype.search);
    } else
      this.stop();
  }

  _onFocusOut = () => {
    this.stop();
  };

  stop() {
    if (!this.findingasyoutype)
      return;

    if (this.findingasyoutype.timeout)
      clearTimeout(this.findingasyoutype.timeout);
    this.findingasyoutype = null;
    this.onsearch('');
  }
}
