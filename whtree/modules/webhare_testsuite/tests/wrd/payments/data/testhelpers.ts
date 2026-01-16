import * as test from "@webhare/test";
import { whconstant_wrd_testschema } from "@mod-system/js/internal/webhareconstants";
import { launchPuppeteer, type Puppeteer } from "@webhare/deps";
import { debugFlags } from "@webhare/env";
import { getPaymentApi } from "@webhare/payments";

const headless = !debugFlags["show-browser"];

let puppeteer: Puppeteer.Browser | undefined;

export async function puppeteerMollie(payurl: string) {
  if (!puppeteer)
    puppeteer = await launchPuppeteer({ headless });

  const context = await puppeteer.createBrowserContext(); //separate cookie storage
  const page = await context.newPage();
  await page.goto(payurl);

  const button = await page.waitForSelector('button[name=issuer][value=ideal_ABNANL2A]');
  await button?.click();

  const radiopaid = await page.waitForSelector('input[name=final_state][value=paid]');
  await radiopaid?.click();

  const submitbutton = await page.waitForSelector('button[name=submit]');
  const [navresult] = await Promise.all([
    page.waitForNavigation(),
    submitbutton!.click()
  ]);

  const jsonresponse = await navresult!.json();

  await puppeteer.close();
  return jsonresponse;
}

export async function runFurtherPaymentTests(params: { pm2: number; completed_payment: number }) {
  const api = getPaymentApi(whconstant_wrd_testschema, {
    providerType: "payprov",
    providerField: "method",
    paymentType: "paydata",
    paymentField: "data"
  });

  const driver = await api.openPaymentProvider(params.pm2);
  const completedPayment = await api.getPaymentValue(params.completed_payment);
  const status = await driver.checkStatus(completedPayment!.getPSPMetadata());
  //verify we still consider that payment approved.
  test.eq("approved", status.setStatus);
}
