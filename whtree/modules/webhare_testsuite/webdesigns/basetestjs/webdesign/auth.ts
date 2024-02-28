import { type OnOpenIdReturnParameters, type WRDAuthCustomizer } from "@webhare/wrd";

export class AuthCustomizer implements WRDAuthCustomizer {
  onOpenIdReturn(params: OnOpenIdReturnParameters) {
    return null;
  }
}
