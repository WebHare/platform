import { RPCFormBase, registerHandler } from "@mod-publisher/js/forms";
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
