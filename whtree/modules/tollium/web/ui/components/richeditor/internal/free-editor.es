import EditorBase from './editorbase';

export default class FreeEditor extends EditorBase
{
  constructor(element, rte, options, undonode)
  {
    super(element, rte, options, undonode);
  }

  execCommand(command, p1, p2)
  {
    try
    {
      // execCommand should be called on the document, not the editable area (contenteditable/designmode)
      this.bodydiv.ownerDocument.execCommand(command, p1, p2);
    }
    catch (e)
    {
      if(this.options.log)
        console.log('ExecCommand exception',e);
      return false;
    }
    return true;
  }

  addListLevel()
  {
    this.execCommand('indent');
    this.stateHasChanged();
  }

  removeListLevel()
  {
    this.execCommand('outdent');
    this.stateHasChanged();
  }

  // Toggle bulleted list for the selection
  _toggleBulletedList()
  {
    this.execCommand('insertunorderedlist');
    this.stateHasChanged();
  }

  // Toggle numbered list for the selection
  _toggleNumberedList()
  {
    this.execCommand('insertorderedlist');
    this.stateHasChanged();
  }

  //ADDME: Use our own function instead of having the browser make something up
  _setAlignment(align)
  {
    var cmd = '';
    switch (align)
    {
      case 'center':
        cmd = 'justifycenter';
        break;
      case 'right':
        cmd = 'justifyright';
        break;
      case 'justified':
        cmd = 'justifyfull';
        break;
      default: // 'left'
        cmd = 'justifyleft';
        break;
    }
    this.execCommand(cmd);
    this.stateHasChanged();
  }

  getAvailableListActions(range)
  {
    let insidelist = range.getAncestorClosest("ul,ol", this.getContentBodyNode());
    let havelist = range.getElementsByTagName("ul,ol,li").length;

    return { canincrease: insidelist || havelist
           , candecrease: insidelist || havelist
           };
  }
}
