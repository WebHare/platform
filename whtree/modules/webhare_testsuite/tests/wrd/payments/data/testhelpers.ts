import { launchPuppeteer, type Puppeteer } from "@webhare/deps";
import { debugFlags } from "@webhare/env";

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
