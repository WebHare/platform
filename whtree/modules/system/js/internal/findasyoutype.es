import * as dompack from 'dompack';
import KeyboardHandler from 'dompack/extra/keyboard';

export default class FindAsYouType
{
  constructor(node, options)
  {
    this.findingasyoutype = null;
    this.findasyoutyperegex = null;

    this.options = { searchtimeout: 0
                   , onsearch: null
                   , ...options
                   };
    this.node=node;
    new KeyboardHandler(node, { "Backspace": evt => this._onKeyboardBackspace(evt)
                              , "Escape":    evt => this._onKeyboardEsc(evt)
                              }, { onkeypress: (evt,key) => this._onKeyboardPress(evt,key) });

    this.focuscallback = evt => this._onFocus(evt);
  }

  _onKeyboardBackspace(event)
  {
    dompack.stop(event);
    if (this.findingasyoutype)
      this._updateFindAsYouType(null);
  }

  _onKeyboardEsc(event)
  {
    if (this.findingasyoutype)
    {
      dompack.stop(event);
      this.stop();
    }
  }

  _onKeyboardPress(event, key)
  {
    if(key.length > 1) //ignore special keys here
      return true;

    if (event.ctrlKey || event.altKey || event.metaKey)
    {
      this.stop();
      return true; // Let browser handle the event
    }

    this._updateFindAsYouType(key);
  }
  _updateFindAsYouType(toadd)
  {
    // If we're already searching, clear the current deactivation timeout
    if (this.findingasyoutype)
    {
      if(this.findingasyoutype.timeout)
        clearTimeout(this.findingasyoutype.timeout);
    }
    else
    {
      // Activate search
      this.findingasyoutype = { timeout: 0 //deactivation timeout
                              , search: "" //currently searching for this string
                              };
      window.addEventListener("focus", this.focuscallback, true);
    }

    // If a backspace was pressed, delete the last character, otherwise add the pressed character to the search string
    if (toadd === null) //backspace
      this.findingasyoutype.search = this.findingasyoutype.search.substr(0, this.findingasyoutype.search.length - 1);
    else
      this.findingasyoutype.search += toadd;

    // If we still have a search string, set the deactivation timeout, otherwise deactivate directly
    if (this.findingasyoutype.search.length)
    {
      if(this.options.searchtimeout)
        this.findingasyoutype.timeout = setTimeout( () => this.stop(), this.options.searchtimeout);

      // Create a regular expression matching string beginning with the (escaped) search string, ignoring case
      this.options.onsearch(this.findingasyoutype.search);
    }
    else
      this.stop();
  }

  _onFocus(evt)
  {
    if(!dompack.contains(this.node, evt.target))
    {
      this.stop(); //focus left our container
    }
  }

  stop()
  {
    if (!this.findingasyoutype)
      return;

    if(this.findingasyoutype.timeout)
      clearTimeout(this.findingasyoutype.timeout);
    window.removeEventListener("focus", this.focuscallback, true);
    this.findingasyoutype = null;
    this.options.onsearch('');
  }
}
