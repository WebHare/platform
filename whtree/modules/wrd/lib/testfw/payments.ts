/** Click testprovider payment approval button

Click the specified approval button if the testframework browser is already on the payment page.
  @param approvetype - Either 'approved' or 'failed'
*/

import { launchPuppeteer, type Puppeteer } from "@webhare/deps";

export async function pushWRDTestPaymentButton(payurl: string, approvetype: string, { cardissuer = "", cardnumber = "" } = {}) {
  const headless = true;
  await using puppeteer = await launchPuppeteer({ headless });
  const context = await puppeteer.createBrowserContext();
  const page = await context.newPage();
  await page.goto(payurl, { waitUntil: "networkidle2" });

  if (cardissuer)
    await page.evaluate(x => document!.querySelector<HTMLInputElement>("[name=cardissuer]")!.value = x, cardissuer);
  if (cardnumber)
    await page.evaluate(x => document!.querySelector<HTMLInputElement>("[name=cardnumber]")!.value = x, cardnumber);

  const button = await page.$(`button[name="approve"][value="${approvetype === "approved" ? "yes" : "no"}"]`);
  if (!button)
    throw new Error(`Cant find '${approvetype}' button`);

  await page.setRequestInterception(true);


  const getPaymentInfo = new Promise<unknown>(resolve => {
    const handleRequest = async (interceptedRequest: Puppeteer.HTTPRequest) => {
      if (interceptedRequest.isNavigationRequest() && interceptedRequest.url().includes("paymentinfo.shtml")) {
        //this is the JSON payment status, return it directly
        const resp = await fetch(interceptedRequest.url());
        resolve(await resp.json());
        await interceptedRequest.abort();
        return;
      }
      await interceptedRequest.continue();
    };

    page.on('request', (interceptedRequest: Puppeteer.HTTPRequest) => void handleRequest(interceptedRequest));
  });

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    button.click()
  ]);

  return await getPaymentInfo;
}
