/* globals describe it */

import { convertHtmlToPlainText } from "@mod-system/js/internal/converthtmltoplaintext.es";
import assert from "assert";
import { JSDOM } from "jsdom";

function jsdom(src)
{
  const dom = new JSDOM(src);
  return dom.window.document;
}

describe("converthtmltoplaintext", () =>
{
  it("clears leading whitespace", () =>
  {
    let dom = jsdom("<html><body> \r\n\ra\r\n\r\n\r\nb\r\n\r\n\r\n\r\nc \r\nd");
    // jsdom removes \r while parsing.
    assert.equal("a\r\n\r\nb\r\n\r\nc\r\nd", convertHtmlToPlainText(dom));
  });

  it("handles normal whitespace", () =>
  {
    let dom;

    // coalescing
    dom = jsdom("a  \u00A0\t\r\nb\r\n");
    assert.equal("a b\r\n", convertHtmlToPlainText(dom));
  });


  it("translates br", () =>
  {
    let dom = jsdom("a<br>b");
    // jsdom removes \r...
    assert.equal("a\r\nb", convertHtmlToPlainText(dom));
  });

  it("ignores style", () =>
  {
    let dom = jsdom("<body><style>a</style></body>");
    assert.equal("", convertHtmlToPlainText(dom));
  });

  it("ignores title", () =>
  {
    let dom = jsdom("<body><title>a</title></body>");
    assert.equal("", convertHtmlToPlainText(dom));
  });

  it("handles links", () =>
  {
    let dom;

    dom = jsdom("<a href='http://a'>a</a>");
    assert.equal("a", convertHtmlToPlainText(dom));

    dom = jsdom("<a href='http://a/'>a</a>");
    assert.equal("a", convertHtmlToPlainText(dom));

    dom = jsdom("<a href='http://a'>b</a>");
    assert.equal("b <URL:http://a>", convertHtmlToPlainText(dom));

    dom = jsdom("<a href='http://a'>b</a>");
    assert.equal("b", convertHtmlToPlainText(dom, { suppress_urls: true }));

    dom = jsdom("<a href='mailto:a'>a</a>");
    assert.equal("a", convertHtmlToPlainText(dom));

    dom = jsdom("<a href='a'>a</a>");
    assert.equal("a", convertHtmlToPlainText(dom));
  });

  it("uses image alt tag", () =>
  {
    let dom;

    dom = jsdom("<img alt='' />");
    assert.equal("", convertHtmlToPlainText(dom));

    dom = jsdom("<img alt='alt' />");
    assert.equal("[alt]", convertHtmlToPlainText(dom));

    dom = jsdom("<img alt='alt' />");
    assert.equal("[[alt]", convertHtmlToPlainText(dom, { imagehandling: 1 }));

    // legacy parameters
    dom = jsdom("<img alt='alt' />");
    assert.equal("[[alt]", convertHtmlToPlainText(dom, 1));
  });

  it("handles lists", () =>
  {
    let dom;

    dom = jsdom("<ul><li>a</li><li>b</li></ul>");
    assert.equal("* a\r\n* b", convertHtmlToPlainText(dom));

    dom = jsdom("<ol><li>a</li><li>b</li></ol>");
    assert.equal("1. a\r\n2. b", convertHtmlToPlainText(dom));

    dom = jsdom("<ol><li>a</li><li value='3'>b</li><li>c</li></ol>");
    assert.equal("1. a\r\n3. b\r\n4. c", convertHtmlToPlainText(dom));

    dom = jsdom("<ol><li>a</li><li value='invalid'>b</li><li>c</li></ol>");
    assert.equal("1. a\r\n2. b\r\n3. c", convertHtmlToPlainText(dom));

    dom = jsdom("<ol start='2'><li>a</li></ol>");
    assert.equal("2. a", convertHtmlToPlainText(dom));

    dom = jsdom("<ol start='-1'><li>a</li></ol>");
    assert.equal("1. a", convertHtmlToPlainText(dom));
  });

  it("handles tables", () =>
  {
    let dom;

    dom = jsdom("<table><tr><th>a</th><td>b</td></tr><tr><td>c</td><td>d</td></tr>");
    assert.equal("a\tb\r\nc\td\r\n", convertHtmlToPlainText(dom));

    dom = jsdom("<table><tr><td><ul><li>a</li></ul></td></tr>");
    assert.equal("* a\r\n", convertHtmlToPlainText(dom));
  });
});

// console.log(dom.documentElement.innerHTML);
