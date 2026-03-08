import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";


export async function htmlToPdf(html: string, outPath: string): Promise<void> {
  // zorg dat de map bestaat
  fs.mkdirSync(path.dirname(outPath), { recursive: true });


  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });

await page.pdf({
  path: outPath,
  format: "A4",
  printBackground: true,
  margin: {
    top: "12mm",
    right: "12mm",
    bottom: "14mm",
    left: "12mm"
  }
});
  } finally {
    await browser.close();
  }
}