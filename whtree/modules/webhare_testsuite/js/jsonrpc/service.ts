import { MyService } from "./type";

export class TestNoAuthJS implements MyService {
  async validateEmail(langcode: string, emailaddress: string): Promise<boolean> {
    return Boolean(emailaddress.match(/webhare.dev$/));
  }
}
