import { launchPuppeteer } from "@webhare/deps";
import { readFileSync } from "fs";

void launchPuppeteer({ headless: true }).then(async browser => {
  const page = await browser.newPage();
  await page.goto("https://www.example.com");
  await page.screenshot({ path: "/tmp/screenshot.png" });
  await browser.close();
  if (readFileSync("/tmp/screenshot.png").length < 512) {
    throw new Error("Screenshot is empty!");
  }
});
