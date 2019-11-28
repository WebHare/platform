import './formtest.scss';
import '@mod-publisher/js/forms/themes/neutral';
import '../../js/components.es'; //ensure their registration runs before forms get initalized
import * as dompack from 'dompack';
import { qS } from 'dompack';
import { RPCFormBase, registerHandler, setupValidator } from '@mod-publisher/js/forms';

//Include the fieldtypes we expect to be using
import ImgEditField from '@mod-publisher/js/forms/fields/imgedit';
import UploadField from '@mod-publisher/js/forms/fields/upload';
import RTDField from '@mod-publisher/js/forms/fields/rtd';
import { URL } from 'dompack/browserfix/url';

//Include extensions to the RTD
import * as embedvideo from '@mod-publisher/js/forms/fields/rtd/embedvideo';

//in development: date & time parts
import { DateField, TimeField } from '@mod-publisher/js/forms/fields/datetime.es';

class CoreForm extends RPCFormBase
{
  constructor(node)
  {
    super(node);
    qS('#coreform .prefillbutton').addEventListener('click', () => this.doPrefill());
    qS('#coreform .validatebutton').addEventListener('click', () => this.validate());
  }

  async doPrefill()
  {
    qS('#coreformsubmitresponse').textContent = JSON.stringify(await this.invokeRPC('prefill'));
  }

  async getFormExtraSubmitData()
  {
    return { proof: 42 };
  }

  onSubmitSuccess(result)
  {
    qS('#coreformsubmitresponse').textContent = JSON.stringify(result);
  }
}

class GlobalForm extends RPCFormBase
{
  onSubmitSuccess(result)
  {
    qS('#globalformsubmitresponse').textContent = JSON.stringify(result);
  }
}

class AnyFormHandler extends RPCFormBase
{
  onSubmitSuccess(result)
  {
    qS('#dynamicformsubmitresponse').textContent = JSON.stringify(result);
  }
}

class DynamicForm extends AnyFormHandler
{
  constructor(node)
  {
    super(node);
    this.node.elements.day.addEventListener('change', () => this.onDayChange());
  }
  async onDayChange()
  {
    await this.invokeRPC('ondaychange', parseInt(this.node.elements.day.value));
  }
}

class RTDForm extends RPCFormBase
{
  constructor(node)
  {
    super(node);

    this.filename = new URL(location.href).searchParams.get("store");
    qS('#rtdform .prefillbutton').addEventListener('click', () => this.doPrefill());
    qS('#rtdform .validatebutton').addEventListener('click', () => this.validate());
  }
  async doPrefill()
  {
    qS('#rtdformresponse').textContent = JSON.stringify(await this.invokeRPC('prefill', this.filename));
  }
  onSubmitSuccess(result)
  {
    qS('#rtdformresponse').textContent = JSON.stringify(result);
  }
}

class ArrayForm extends RPCFormBase
{
  onSubmitSuccess(result)
  {
    qS('#dynamicformsubmitresponse').textContent = JSON.stringify(result);
  }
}

if(location.href.includes('customemailvalidator=1'))
{
  //warn against qq@beta.webhare.net - but a custom validation shouldn't break required/email validation
  dompack.register("input[type=email]", node => setupValidator(node, function()
  {
    if(node == "qq@beta.webhare.net")
      return <span>Please use another email</span>;
  }));
}

dompack.register('#coretest-setvalidator',
    node => setupValidator(node, node =>
      {
        if(!node.value)
          return "R<a>am";
        if(node.value=="raam")
          return "Roos";
        if(node.value=="richerror")
          return <a href="#test">Rich Error</a>;

        return "";
      }));

if(location.href.includes('captureerrors=1'))
{
  //take over the update error handler
  window.addEventListener("wh:form-displaymessage", evt =>
  {
    if(evt.detail.type != 'error')
      return;

    evt.preventDefault();
    if(evt.detail.message && !evt.detail.field)
      throw new Error("Received error but no indication of failed field");
    if(!evt.detail.message && evt.detail.field)
      throw new Error("Received failed field but no actual error");

    if(evt.detail.field)
      evt.detail.field.classList.add("broken");

    dompack.qSA(evt.target, '.customerror').forEach(dompack.remove);
    dompack.append(evt.target, dompack.create("div", { className: "customerror", childNodes: [evt.detail.message] }));
  });
}

let currentvideonode = null;

async function onInsertVideoSubmit(evt)
{
  evt.preventDefault();

  let result = await RTDField.getForNode(currentvideonode).insertVideoByURL(document.querySelector('#insertvideo__url').value);
  if(result.success)
  {
    qS('#insertvideo').style.display='none';
    return;
  }
  alert(result.message);
}

dompack.register(".wh-form__page", page => page.addEventListener("wh:form-pagechange", evt =>
  {
    let pagenumber = dompack.qSA('.wh-form__page').indexOf(evt.target);
    if(dompack.qS("#currentpage"))
      dompack.qS("#currentpage").textContent = 1+pagenumber;
  }));

function initForms()
{
  registerHandler('coretest', node => new CoreForm(node));
  registerHandler('globalform', node => new GlobalForm(node));
  dompack.register('#dynamicform', node => new DynamicForm(node));
  registerHandler("rtdform", node => new RTDForm(node));
  dompack.register('#insertvideo__submit', node => node.addEventListener("click",onInsertVideoSubmit));
  registerHandler("arrayform", node => new ArrayForm(node));
  registerHandler('anyformhandler', node => new AnyFormHandler(node));

  let rtdopts = {};
  if(location.href.includes('video=1'))
    rtdopts.onInsertVideo = embedvideo.insertVideo;

  dompack.register(".wh-form__rtd", node => new RTDField(node, rtdopts));
  dompack.register(".wh-form__imgedit", node => new ImgEditField(node));

  if(location.href.includes('rtd=1') || location.href.includes('array=1') || location.href.includes('method=htmlonly')) //note - the uploadfield should not actually upgrade htmlonly uploads
    dompack.register(".wh-form__upload", node => new UploadField(node));

  if(location.href.includes("splitdatetime=1"))
  {
    dompack.register(".wh-form__date", node =>
      {
        let opts;
        if(node.name == 'weeknumbers')
          opts = {...opts, weeknumbers: true};
        node.formtestDateHandler = new DateField(node, opts);
      });
    dompack.register(".wh-form__time", node => new TimeField(node));
  }
}

if(!location.href.includes('method=htmlonly'))
{
  if(location.href.includes("dompackpulldown=1"))
    dompack.onDomReady(initForms); //delay so pulldowns get a chance to register first, a test requires the pulldowns to have done their DOM duplication before we run
  else
    initForms();
}


dompack.register("#datetime_debugging", node => node.addEventListener("click", function()
  {
    dompack.qSA(".datetime--replaced").forEach(node => node.classList.remove("datetime--replaced"));
    dompack.qSA("input[type=date], input[type=time]").forEach(node =>
      {
        var inputcount=0, changecount=0;
        node.addEventListener("input",  evt => console.log("Input event #%d on %s: %o", ++inputcount, node.name, evt));
        node.addEventListener("change", evt => console.log("Change event #%d on %s: %o", ++changecount, node.name, evt));
      });
  }));
