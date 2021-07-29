import { RPCFormBase, registerHandler, setupValidator } from "@mod-publisher/js/forms";
import * as dompack from "dompack";

class CustomForm2 extends RPCFormBase
{
  constructor(node)
  {
    super(node);

    node.textarea.parentNode.appendChild(
        <button id="rpc_test" type="button" onclick={evt => this.gotClick(evt)}>Run RPC</button>);
  }

  async gotClick(evt)
  {
    evt.stopPropagation();
    evt.preventDefault();

    const retval = await this.invokeRPC("TestRPC");

    this.node.textarea.value = retval.textarea;
  }
}

registerHandler("webhare_testsuite:customform2", node => new CustomForm2(node));

// Add async validation via setupValidator
dompack.register(`form[data-wh-form-handler="webhare_testsuite:customform2"] [name=textarea]`, node => setupValidator(node, async () =>
  {
    // make it async and really slow
    await new Promise(resolve => setTimeout(resolve, 250));

    if (node.value != "RPC ok")
    {
      return "RPC not called yet";
    }

    return null;
  }));
