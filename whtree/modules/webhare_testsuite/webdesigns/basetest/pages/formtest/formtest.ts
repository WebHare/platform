import './formtest.scss';
import '@mod-publisher/js/forms/themes/neutral';
import '../../js/components'; //ensure their registration runs before forms get initalized
import { create, onDomReady, qR, qS, qSA, register } from '@webhare/dompack';
import { RPCFormBase, registerHandler, setupValidator } from '@mod-publisher/js/forms';

//Include the fieldtypes we expect to be using
import ImgEditField from '@mod-publisher/js/forms/fields/imgedit';
import UploadField from '@mod-publisher/js/forms/fields/upload';
import RTDField from '@mod-publisher/js/forms/fields/rtd';

//Include extensions to the RTD
import * as embedvideo from '@mod-publisher/js/forms/fields/rtd/embedvideo';

//in development: date & time parts
import { DateField, TimeField } from '@mod-publisher/js/forms/fields/datetime';

class CoreForm extends RPCFormBase {
  constructor(node: HTMLFormElement) {
    super(node);
    qR('#coreform .prefillbutton').addEventListener('click', () => this.doPrefill());
    qR('#coreform .validatebutton').addEventListener('click', () => this.validate());

    if (new URL(location.href).searchParams.get("sethiddenfield") === "javascript")
      this.setFieldValue(this.getElementByName("hidden")! as HTMLElement, "value-javascript");
  }

  async doPrefill() {
    qR('#coreformsubmitresponse').textContent = JSON.stringify(await this.invokeRPC('prefill'));
  }

  async getFormExtraSubmitData() {
    return { proof: 42 };
  }

  onSubmitSuccess(result: unknown) {
    qR('#coreformsubmitresponse').textContent = JSON.stringify(result);
  }
}

class GlobalForm extends RPCFormBase {
  onSubmitSuccess(result: unknown) {
    qR('#globalformsubmitresponse').textContent = JSON.stringify(result);
  }
}

class AnyFormHandler extends RPCFormBase {
  onSubmitSuccess(result: unknown) {
    qR('#dynamicformsubmitresponse').textContent = JSON.stringify(result);
  }
}

class DynamicForm extends AnyFormHandler {
  constructor(node: HTMLFormElement) {
    super(node);
    qR(this.node, '[name=day]').addEventListener('change', () => this.onDayChange());
  }
  async onDayChange() {
    await this.invokeRPC('ondaychange', parseInt(qR<HTMLInputElement>(this.node, '[name=day]').value));
  }
}

class MultiPageForm extends AnyFormHandler {
  constructor(node: HTMLFormElement) {
    super(node);
    qR(this.node, ".wh-form__prologue").prepend(create("div", { textContent: "This block should always be in view eg for page navigation", class: "multipageform__prefix" }));
  }
}

class RTDForm extends RPCFormBase {
  filename;

  constructor(node: HTMLFormElement) {
    super(node);

    this.filename = new URL(location.href).searchParams.get("store");
    qR('#rtdform .prefillbutton').addEventListener('click', () => this.doPrefill());
    qR('#rtdform .validatebutton').addEventListener('click', () => this.validate());
  }
  async doPrefill() {
    qR('#rtdformresponse').textContent = JSON.stringify(await this.invokeRPC('prefill', this.filename));
  }
  onSubmitSuccess(result: unknown) {
    qR('#rtdformresponse').textContent = JSON.stringify(result);
  }
}

class ArrayForm extends RPCFormBase {
  onSubmitSuccess(result: unknown) {
    qR('#dynamicformsubmitresponse').textContent = JSON.stringify(result);
  }
}

if (location.href.includes('customemailvalidator=1')) {
  //warn against qq@beta.webhare.net - but a custom validation shouldn't break required/email validation
  register<HTMLInputElement>("input[type=email]", node => setupValidator(node, (n: HTMLInputElement) => {
    if (n.value === "qq@beta.webhare.net")
      return create("span", { textContent: "Please use another email" });
  }));
}

register<HTMLInputElement>('#coretest-setvalidator',
  node => setupValidator(node, n => {
    if (!n.value)
      return "R<a>am";
    if (n.value === "raam")
      return "Roos";
    if (n.value === "richerror")
      return create("a", { href: "#test", textContent: "Rich Error" });

    return "";
  }));

register(".wh-form__page", page => page.addEventListener("wh:form-pagechange", evt => {
  const pagenumber = qSA('.wh-form__page').indexOf(evt.target as HTMLElement);
  if (qS("#currentpage"))
    qR("#currentpage").textContent = String(1 + pagenumber);
}));

function initForms() {
  registerHandler('coretest', node => new CoreForm(node));
  registerHandler('globalform', node => new GlobalForm(node));
  registerHandler('multipageform', node => new MultiPageForm(node));
  registerHandler('dynamicform', node => new DynamicForm(node));
  registerHandler("rtdform", node => new RTDForm(node));
  registerHandler("arrayform", node => new ArrayForm(node));
  registerHandler('anyformhandler', node => new AnyFormHandler(node));

  register(".wh-form__rtd", node => new RTDField(node, {
    onInsertVideo: location.href.includes('video=1') ? embedvideo.insertVideo : undefined
  }));
  register(".wh-form__imgedit", node => new ImgEditField(node));

  if (location.href.includes('rtd=1') || location.href.includes('array=1'))
    register(".wh-form__upload", node => new UploadField(node));

  if (location.href.includes("splitdatetime=1")) {
    register<HTMLInputElement>(".wh-form__date", node => {
      const datefield = new DateField(node, { weeknumbers: node.name === "weeknumbers" });
      //@ts-ignore -- we're adding a property to the node for testing purposes
      node.formtestDateHandler = datefield;
    });
    register(".wh-form__time", node => new TimeField(node));
  }
}

if (location.href.includes("dompackpulldown=1"))
  onDomReady(initForms); //delay so pulldowns get a chance to register first, a test requires the pulldowns to have done their DOM duplication before we run
else
  initForms();

register("#datetime_debugging", node => node.addEventListener("click", function () {
  qSA(".datetime--replaced").forEach(el => el.classList.remove("datetime--replaced"));
  qSA<HTMLInputElement>("input[type=date], input[type=time]").forEach(el => {
    let inputcount = 0, changecount = 0;
    el.addEventListener("input", evt => console.log("Input event #%d on %s: %o", ++inputcount, el.name, evt));
    el.addEventListener("change", evt => console.log("Change event #%d on %s: %o", ++changecount, el.name, evt));
  });
}));
