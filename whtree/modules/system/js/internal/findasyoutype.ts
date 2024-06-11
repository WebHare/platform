/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation
import * as dompack from '@webhare/dompack';
import KeyboardHandler from 'dompack/extra/keyboard';

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
    new KeyboardHandler(node, {
      "Backspace": evt => this._onKeyboardBackspace(evt),
      "Escape": evt => this._onKeyboardEsc(evt)
    }, { onkeypress: (evt, key) => this._onKeyboardPress(evt, key) });
  }

  _onKeyboardBackspace(event) {
    dompack.stop(event);
    if (this.findingasyoutype)
      this._updateFindAsYouType(null);
  }

  _onKeyboardEsc(event) {
    if (this.findingasyoutype) {
      dompack.stop(event);
      this.stop();
    }
  }

  _onKeyboardPress(event, key) {
    if (key.length > 1) //ignore special keys here
      return true;

    if (event.ctrlKey || event.altKey || event.metaKey) {
      this.stop();
      return true; // Let browser handle the event
    }

    dompack.stop(event);
    this._updateFindAsYouType(key);
  }
  _updateFindAsYouType(toadd: string) {
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
      window.addEventListener("focus", this._onFocus, true);
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

  _onFocus = (evt: Event) => {
    if (evt.target && !this.node.contains(evt.target as Node)) {
      this.stop(); //focus left our container
    }
  };

  stop() {
    if (!this.findingasyoutype)
      return;

    if (this.findingasyoutype.timeout)
      clearTimeout(this.findingasyoutype.timeout);
    window.removeEventListener("focus", this._onFocus, true);
    this.findingasyoutype = null;
    this.onsearch('');
  }
}
