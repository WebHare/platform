import * as dompack from 'dompack';
import { ObjAutoSuggestableBase } from '../textedit/textedit.es';

var TagEdit = require('@mod-tollium/web/ui/components/tagedit/tagedit.es');
var $todd = require('@mod-tollium/web/ui/js/support');

export default class ObjTagEdit extends ObjAutoSuggestableBase
{
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "tagedit";
    this.components = [];
    this.value = "";
    this.separator = ",";
    this.allowmultiple = false;
    this.casesensitive = false;
    this.placeholder = "";
    this.validatequeries = [];
    this.validatequerycounter = 0;
    this.separator = data.separator;
    this.allowmultiple = data.allowmultiple;
    this.casesensitive = data.casesensitive;
    this.placeholder = data.placeholder;
    this.validatetags = data.validatetags;
    this.setValue(data.value);

    // Build our DOM
    this.buildNode();

    this.setRequired(data.required);
    this.setEnabled(data.enabled);
  }

/****************************************************************************************************************************
 * Property getters & setters
 */

  getSubmitValue()
  {
    return this.control
        ? { tags:                 this.control.getStringValue()
          , hasunprocessedinput:  this.control.haveUnprocessedInput()
          }
        : { tags:                 this.value
          , hasunprocessedinput:  false
          };
  }

  getValue()
  {
    return this.control ? this.control.getStringValue() : this.value;
  }

  setValue(value)
  {
    if (value != this.value)
    {
      this.value = value;
      if (this.control)
        this.control.setStringValue(this.value);
    }
  }

  setRequired(value)
  {
    if (value === this.required)
      return;

    this.required = value;
    this.control.setRequired(value);
  }

  setEnabled(value)
  {
    if (value === this.enabled)
      return;

    this.enabled = value;
    this.control.setEnabled(value);
  }

/****************************************************************************************************************************
* DOM
*/

  buildNode()
  {
    this.control = new TagEdit(null, { tagSeparator: this.separator
                                     , allowMultiple: this.allowmultiple
                                     , caseSensitive: this.casesensitive
                                     , placeholder: this.placeholder
                                     , multiline: true
                                     , validatetags: this.validatetags ? this._validateTags.bind(this) : null
                                     });

    this._autosuggester = this.setupAutosuggest(this.control.inputnode);

    if (this.value)
      this.control.setStringValue(this.value);
    this.node = this.control.toElement();
    if(this.hint)
      this.node.title = this.hint;
    this.node.dataset.name = this.name;
    this.node.propTodd = this;
    this.node.addEventListener("wh:tagedit-change", evt => this.onAnyChange(evt));
  }

/****************************************************************************************************************************
 * Component management
 */

  calculateDimWidth()
  {
    this.width.overhead = 0;//$wh.getHorizontalOverhead(this.node);
    this.width.min = $todd.desktop.x_width*2 + this.width.overhead;
    this.width.calc = 150;
  }

  calculateDimHeight()
  {
    this.height.overhead = 0;//$wh.getVerticalOverhead(this.node);
    this.height.min = 23;
    this.height.calc = 23;
  }

   relayout()
   {
     this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);
     dompack.setStyles(this.node, { width: this.width.set// - this.width.overhead
                                  , height: 23
                                  , "margin-top": this.getVerticalPosition()
                                  });
     this.control._resizeInput();
   }


/****************************************************************************************************************************
 * Callbacks
 */

  _validateTags(tags)
  {
    ++this.validatequerycounter;
    this.queueMessage('validatetags', { tags: tags, msgid: this.validatequerycounter }, true);

    var defer = dompack.createDeferred();
    this.validatequeries.push({ msgid: this.validatequerycounter, defer: defer });
    return defer.promise;
  }

  onMsgValidateTagsReply(data)
  {
    for (var i = 0; i < this.validatequeries.length; ++i)
    {
      if (this.validatequeries[i].msgid == data.replyto)
      {
        this.validatequeries[i].defer.resolve(data.tags);
        this.validatequeries.splice(i, 1);
        return;
      }
    }
  }

  onAnyChange()
  {
    this.setDirty();
  }
}

