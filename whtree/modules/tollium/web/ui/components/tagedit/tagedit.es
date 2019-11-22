import * as dompack from 'dompack';
import KeyboardHandler from "dompack/extra/keyboard";
require('./tagedit.css');

/*
  A simple tag editor.

  Example usage:
    <input name="tags" value="aap;noot ; mies ;aap" class="tageditor" placeholder="Add more..." />

    document.getElements("input.tageditor").each(function(input)
    {
      new TagEdit(input, { tagSeparator: ";" });
    });

    [ [aap] [noot] [mies] [aap] |Add more... ]

  Options:
    tagSeparator (default: ",")
      Tag separator within the input value
    allowMultiple (default: false)
      Allow tags to appear multiple times
    caseSensitive (default: false)
      If multiple tag check if case sensitive
    allowReorder (default: true)
      Allow tags to be reordered using drag-n-drop (currently unsupported)
    enabled (default: true)
      If the input is currently enabled
    placeholder (default: "")
      Placeholder text (overrides the original input's placeholder attribute)
*/

class TagEdit
{
  constructor(el, options)
  {
    this.tabindex = 0;         // Tab index for focusing our node
    this.el = null;            // Original input element
    this.node = null;          // Container node for tags and input
    this.inputnode = null;     // Tag input node
    this.autocomplete = null;  // $wh.AutoComplete object
    this.tags = [];            // The list of actual tags, either a string (no node yet), or a { tag, node } object
    this.selectedTag = null;   // Currently selected tag (a { tag, node } object within tags)
    this.inputFocused = false; // If the input node currently is focused

    // Initialize
    this.options = { tagSeparator: ","     // Tag separator within the input value
                   , allowMultiple: false  // Allow tags to appear multiple times
                   , caseSensitive: false  // If multiple tag check if case sensitive
                   , allowReorder: true    // Allow tags to be reordered using drag-n-drop
                   , enabled: true         // If the input is currently enabled
                   , placeholder: ""       // Placeholder text (overrides the original input's placeholder attribute)
                   , multiline: true       //
                   , validatetags: null    // Function to filter for valid tags
                   , ...options
                   };

    this.el = el;

    // Create DOM nodes
    this._buildNode();

    if (this.el)
    {
      // Read initial tags from input node, will fill the tags array
      this.setStringValue(this.el.value);
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  /** @short Add a new tag
      @long This function adds a new tag. If tags may not appear multiple times and a tag with the given text is already
            present, the tag is not added.
      @param text The text of the tag to add
      @param callback The function that is called after the tag is added (it isn't called when not added)
  */
  addTag(text)
  {
    this._validateAndAddTag(text);
  }

  /** @short Check if a tag with the given text is present
      @param text The text to check
      @return If a tag with the given text is present
  */
  hasTag(text)
  {
    // getTag will return the first matching tag
    return !!this._getTag(text);
  }

  /** @short Delete a tag
      @long This function deletes a tag. If tags may appear multiple times, all tags with the given text are deleted.
  */
  deleteTag(text)
  {
    // getTag will return the first matching tag
    var tag = this._getTag(text);
    while (tag)
    {
      // Remove the tag from the array
      this.tags = this.tags.filter(function(check)
      {
        return check != tag;
      });
      // Get a reference to the next node to focus
      var selNode = tag.node.nextSibling;
      tag.node.remove();
      // If the next node is the input node, focus it, otherwise select the tag node
      if (!selNode || selNode === this.inputnode)
        dompack.focus(this.inputnode);
      else
        this._setSelectedTag(selNode);

      // Check if there is another matching tag
      tag = this._getTag(text);
    }
    this._setInputValue();
  }

  /** @short Get the tags
  */
  getValue()
  {
    return this.tags.map(function(tag)
    {
      return typeof tag === "string" ? tag : tag.tag;
    });
  }

  /** @short Get the tags as concatenated string
  */
  getStringValue()
  {
    return this.getValue().join(this.options.tagSeparator);
  }

  setStringValue(value)
  {
    var wasempty = this.tags.length == 0;
    this.tags = [];
    this._updateTagNodes();
    this._addTagsFromValue(value, false);

    // Resync the value in the coupled input when _addTagsFromValue didn't do that because there was nothing to add
    if (!wasempty && !this.tags.length)
      this._setInputValue();
  }

  /** @short Get the tagedit node
  */
  toElement()
  {
    return this.node;
  }

  haveUnprocessedInput()
  {
    return this._getInputText().trim() != '';
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions - node building
  //

  /** Build the tagedit node
  */
  _buildNode()
  {
    // Create the container node, holding the tag nodes and input node
    this.node = <span class={"wh-tagedit" + (this.el && this.el.className ? " " + this.el.className : "")}
                      style="display: inline-block; overflow: hidden"
                      onMousedown={evt=>this._onNodeMouseDown(evt)}
                      onClick={evt=>this._onNodeClick(evt)} />

    new KeyboardHandler(this.node, { Backspace: () => this._deleteSelectedTag()
                                   , Delete: () => this._deleteSelectedTag()
                                   , ArrowLeft: () => this._selectTag(-1)
                                   , ArrowUp: () => this._selectTag(-1)
                                   , ArrowRight: () => this._selectTag(+1)
                                   , ArrowDown: () => this._selectTag(+1)
                                   , Tab: () => this._focusInputNode()
                                   , Escape: () => this._deselectTag()
                                   });


    if (!this.options.multiline)
      this.node.style.whiteSpace = "nowrap";
    else
      this.node.style.whiteSpace = "normal";

    if (this.el)
      this.el.before(this.node);

    // Create the input node as a content-editable span
    this.inputnode = <input type="text" class="wh-tagedit-input"
                      onFocus={evt => this._onInputFocus(evt)}
                      onBlur={evt => this._onInputBlur(evt)}
                      onKeyup={evt => this._onInputKeyUp(evt)}
                      onKeypress={evt => this._onInputKeyPress(evt)} />;

    new KeyboardHandler(this.inputnode, { "Backspace": () => this._goLeftToTag()
                                        , "ArrowLeft": () => this._goLeftToTag()
                                        , "Enter": () => this._enterTag()
                                        , "ArrowDown": () => this._goDownToMenu()
                                        }, { captureunsafekeys: true });

    dompack.setStyles(this.inputnode, { "-webkit-appearance": "none"
                                      , "border": "none"
                                      , "box-sizing": "border-box"
                                      , "cursor": "text"
                                      , "display": "inline-block"
                                      , "max-width": "100%"
   //                                   , "outline": "none"
                                      , "overflow": "hidden"
                                      , "vertical-align": "top"
                                      , "white-space": "nowrap"
                                      });
    this.node.append(this.inputnode);

    this.inputnode.addEventListener("dompack:autosuggest-selected", evt => this._onAutoSuggest(evt));

    // Read some attributes from the original input node, the hide it
    if (this.el)
    {
      this.tabindex = this.el.tabIndex || 0;
      this.options.placeholder = this.options.placeholder || this.el.placeholder;
      this.el.style.display = "none";
    }

    // Enable focus for key navigation
    this.node.setAttribute("tabindex", this.options.enabled ? this.tabindex : -1);

    this.setEnabled(this.options.enabled);
    this.setRequired(this.options.required);

    if (this.options.placeholder)
      this.inputnode.placeholder = this.options.placeholder;

    // Make the input large enough to at least fit the placeholder, with a minimum of 30 pixels
    this.sizenode = <span class="wh-tagedit-input" />;
    this.sizenode.style.cssText = this.inputnode.style.cssText;
    this.sizenode.style.visibility = "hidden";
    this.node.append(this.sizenode);
    this._resizeInput();

    // Create the nodes for the tags
    this._updateTagNodes();
  }

  setEnabled(newenabled)
  {
    this.options.enabled = newenabled;
    this.inputnode.style.display = newenabled ? "" : "none";
    this.node.classList.toggle("disabled",!newenabled);
  }

  setRequired(newrequired)
  {
    this.options.required = newrequired;
    //this.node.classList.toggle("required",newrequired);
  }

  // Delete the currently selected tag
  _deleteSelectedTag()
  {
    if(!this.selectedTag)
      return true;

    this.deleteTag(this.selectedTag);
    this._fireChangeEvent();
    return true;
  }

  // Select the previous or next tag , or focus the input node when the last tag was selected
  _selectTag(dir)
  {
    if (!this.selectedTag)
      return;

    let selNode = this.selectedTag.node[ dir < 0 ? "previousSibling" : "nextSibling" ];
    if (selNode === this.inputnode)
      dompack.focus(this.inputnode);
    else if(selNode)
      this._setSelectedTag(selNode);

    return true;
  }

  _focusInputNode()
  {
    dompack.focus(this.inputnode);
    return true;
  }

  _deselectTag()
  {
    this._setSelectedTag(null);
    return true;
  }

  _onAutoSuggest(evt)
  {
    evt.preventDefault();
    evt.detail.autosuggester.closeSelectList();

    // Validate and add the tag
    var res = this._validateAndAddTag(evt.detail.value, true);

    // After that clear the current input
    res.then(this._setInputText.bind(this, ""));

    // And then fire a change event
    res.then(this._fireChangeEvent.bind(this));

    // And set focus back to the typing field
    res.then( () => dompack.focus(this.inputnode));
  }

  /** Create tag nodes for all nodes
  */
  _updateTagNodes()
  {
    // Remove current tag nodes
    dompack.qSA(this.node, ".wh-tagedit-tag").forEach(node => node.remove());

    var prevtag = null;
    this.tags.forEach((tag, idx) =>
    {
      // If tag is a simple string, create a node for it
      if (typeof tag === "string")
      {
        this.tags[idx] = { tag: tag
                         , node: this._createTagNode(tag)
                         };
        tag = this.tags[idx];
      }

      // If there is no previous tag, insert it at the start of the element, otherwse insert it after the previous tag
      if (!prevtag)
        this.node.prepend(tag.node);
      else
        prevtag.node.after(tag.node);
      prevtag = tag;
    });
  }

  /** Create a new tag node
  */
  _createTagNode(text)
  {
    // Create a node for the tag
    return <span class="wh-tagedit-tag"
                 style="box-sizing: border-box; display: inline-block; vertical-align: top; white-space: nowrap"
                 onMousedown={evt => this._onTagMouseDown(evt)} >{text}</span>
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions - manipulation
  //

  /** Validates and adds a single tag
      @param text Tag to add
      @param from_autocomplete If the source was the autocomplete service
      @return Promise, bool whether a tag was added
  */
  _validateAndAddTag(text, from_autocomplete)
  {
    // Clean tag whitespace
    text = text.trim();
    if (text)
      return this._addTagsFromValues([ text ], from_autocomplete);

    return Promise.resolve(false);
  }

  /** Test if the autocomplete results contains a certain tag
      @param text Tag to test for
      @param result Autocomplete result
      @return(bool) Whether the tag is present in the result (case-insensitive)
  */
  _testAutoCompleteResultContainsTag(text, result)
  {
    return result.values.some(function(value)
    {
      return value.value.toUpperCase() == text.toUpperCase();
    });
  }

  /** Filter out duplicate tags before adding them
  */
  _filterCopiesAndClean(tags)
  {
    if (this.options.allowMultiple)
      return tags;

    var newtags = [];
    var unewtags = [];

    tags.forEach(tag=>
    {
      tag = tag.trim();
      if (!tag || this.hasTag(tag))
        return;

      var testtag = this.options.caseSensitive ? tag.toUpperCase() : tag;
      if (unewtags.includes(testtag))
        return;

      newtags.push(tag);
      unewtags.push(testtag);
    });

    return newtags;
  }

  _checkValidateTagsResult(results)
  {
    if (results && Array.isArray(results))
      return results;

    console.error("Return value of tagedit options.validatetags is not an array", this.options.validatetags, results);
    return [];
  }

  /** Validates a list of tags, returns a promise with the list of valid tags
      @param tags List of tags to Validate
      @param from_autocomplete If the source is from the autocomplete service
      @return Promise, result is the list of filtered tags
  */
  _validateTags(tags, from_autocomplete)
  {
    // Filter out duplicates (with current tag list and within new tags themselves)
    tags = this._filterCopiesAndClean(tags);

    // Construct a promise with the vanilla list
    var retval = Promise.resolve(tags);

    // No tags: thay are all valid!
    if (!tags.length)
      return retval;

    if (this.options.validatetags)
      return retval.then(this.options.validatetags).then(this._checkValidateTagsResult.bind(this));

    return retval;
  }

  _addValidTags(newtags)
  {
    this.tags.push(...newtags);
    this._setInputValue();

    // Update the tag nodes
    this._updateTagNodes();
  }

  /** Add tags from a value (will be split on separator)
      @param value String with multiple tags
  */
  _addTagsFromValue(value, from_autocomplete)
  {
    // Split the value using the tag separator, add each tag recursively
    return this._addTagsFromValues(value.split(this.options.tagSeparator), from_autocomplete);
  }

  /** Add multiple tags from values) */
  _addTagsFromValues(values, from_autocomplete)
  {
    if (values.length == 0)
      return Promise.resolve(false);

    var res = this._validateTags(values, from_autocomplete);

    // When we have the valid tags, add them, return whether we have added a tag
    res.then(function(validtags)
    {
      this._addValidTags(validtags);
      return validtags.length != 0;
    }.bind(this));

    res = res["catch"](function(e) { console.error('Got exception validating tags: ', e.stack || e); return []; });

    return res;
  }

  /** Resync the input value */
  _setInputValue()
  {
    if (!this.el)
      return;
    this.el.value = this.getStringValue();
  }

  _getInputText()
  {
    return this.inputnode.value;
  }

  /** Process all the text from the user input, convert to tags and fire the 'change' event
  */
  _processInputText()
  {
    var text = this._getInputText();
    if (text)
    {
      let requestlock = dompack.flagUIBusy();
      this._addTagsFromValue(text).then(this._clearInputText.bind(this)).then(this._fireChangeEvent.bind(this)).finally( () => requestlock.release());
    }
    this._resizeInput();
  }

  /// Clear the input text
  _clearInputText()
  {
    this._setInputText("");
  }

  /// Set the input text to a certain value
  _setInputText(text, update)
  {
    this.inputnode.value = text;

    if (update)
      this._updateTagNodes();
  }

  _resizeInput()
  {
    // Check if we've already checked the size of the placeholder text
    if (!this.minwidth)
    {
      if (this.options.placeholder)
      {
        this.sizenode.textContent = this.options.placeholder;
        // We might not yet be present or visible in the DOM
        let sizenodewith = this.sizenode.getBoundingClientRect().width
        if (sizenodewith)
          this.minwidth = Math.max(sizenodewith, 30);
      }
      else
        this.minwidth = 30;
    }
    this.sizenode.textContent = this.inputnode.value;
    this.inputnode.style.width = Math.max(this.minwidth, this.sizenode.getBoundingClientRect().width + 20) + 'px';
  }

  /** Lookup a tag
      @param tag String or element from tag array
  */
  _getTag(tag)
  {
    // If not searching for a string, find the requested tag object
    if (typeof tag != "string")
      return this.tags.filter(function(check)
      {
        return check === tag;
      })[0];

    // Find the tag with the requested text
    if (!this.options.caseSensitive)
      tag = tag.toUpperCase();
    return this.tags.filter(function(check)
    {
      check = typeof check === "string" ? check : check.tag;
      return (this.options.caseSensitive ? check : check.toUpperCase()) === tag;
    }, this)[0];
  }

  /** Set the currently selected tag (by node)
      @param tagNode Tag node to select
  */
  _setSelectedTag(tagNode)
  {
    // Find the tag with the request node
    var tag = this.tags.filter(function(check)
    {
      return typeof check === "object" && check.node === tagNode;
    })[0];
    if (this.selectedTag === tag)
      return;

    // The currently selected tag is no longer selected
    if (this.selectedTag)
      this.selectedTag.node.classList.remove("wh-tagedit-selected");
    // Select the new tag
    this.selectedTag = tag;
    if (this.selectedTag)
    {
      dompack.focus(this.node);
      this.selectedTag.node.classList.add("wh-tagedit-selected");
    }
  }

  /// Fire a change event (when list of tags has changed)
  _fireChangeEvent()
  {
    //fire custom event so we don't get confused by input change events
    dompack.dispatchCustomEvent(this.node, "wh:tagedit-change", { bubbles: true, cancelable: false });
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //

  _onNodeMouseDown(event)
  {
    if (event.target == this.node)
      event.preventDefault();
  }

  _onNodeClick(event)
  {
    if (event.target == this.node)
      dompack.focus(this.inputnode);
  }

  _onTagMouseDown(event)
  {
    dompack.stop(event);
    this._setSelectedTag(event.target.closest(".wh-tagedit-tag"));
  }

  _onInputFocus()
  {
    // Deselect any selected tag
    this._setSelectedTag(null);
    this.inputFocused = true;
  }

  _onInputBlur()
  {
    this.inputFocused = false;
  }

  _goLeftToTag()
  {
    // If nothing is selected and the cursor is at the leftmost position of the input, select the last tag and blur the input
    var haveSelection = false;
    haveSelection = this.inputnode.selectionStart + this.inputnode.selectionEnd === 0;

    if (this.tags.length && haveSelection)
    {
      this._setSelectedTag(this.tags.slice(-1)[0].node);
      if (this.selectedTag)
      {
        this.inputnode.blur();
        return true; //handled!
      }
    }
    return false;
  }
  _enterTag()
  {
    this._processInputText();
    return true;
  }
  _goDownToMenu()
  {
    if (this.autocomplete && this.autocomplete.trySelectFirstMenuItem())
      return true;
    return false;
  }
  _onInputKeyUp(event)
  {
    this._resizeInput();
  }

  _onInputKeyPress(event)
  {
    // Add the entered text as tag
    if (event.key == this.options.tagSeparator)
    {
      dompack.stop(event);
      this._processInputText();
    }
  }
}

module.exports = TagEdit;
