import { RPCFormBase, registerHandler, setupValidator } from "@mod-publisher/js/forms";
import * as dompack from "@webhare/dompack";

class CustomForm2 extends RPCFormBase {
  constructor(node: HTMLFormElement) {
    super(node);

    node.textarea.parentNode.appendChild(
      <button id="rpc_test" type="button" onclick={(evt: MouseEvent) => this.gotClick(evt)}>Run RPC</button>);
  }

  async gotClick(evt: MouseEvent) {
    evt.stopPropagation();
    evt.preventDefault();

    const retval = await this.invokeRPC("TestRPC") as { textarea: string };
    this.node.textarea.value = retval.textarea;
  }
}

async function myValidator(node: HTMLInputElement) {
  // make it async and really slow
  await new Promise(resolve => setTimeout(resolve, 250));

  if (node.value !== "RPC ok") {
    return "RPC not called yet";
  }

  return "";
}

registerHandler("webhare_testsuite:customform2", node => new CustomForm2(node));

// Add async validation via setupValidator
dompack.register<HTMLInputElement>(`form[data-wh-form-handler="webhare_testsuite:customform2"] [name=textarea]`,
  node => setupValidator(node, myValidator));
