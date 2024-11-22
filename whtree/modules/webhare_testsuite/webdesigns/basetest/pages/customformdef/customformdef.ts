import { RPCFormBase, registerHandler } from "@mod-publisher/js/forms";

class CustomFormDef extends RPCFormBase {
}

registerHandler("webhare_testsuite:customformdef", node => new CustomFormDef(node));
