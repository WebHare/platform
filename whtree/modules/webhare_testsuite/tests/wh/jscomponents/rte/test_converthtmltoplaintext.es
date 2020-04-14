import * as test from "@mod-tollium/js/testframework";
import { convertHtmlToPlainText } from "@mod-system/js/internal/converthtmltoplaintext.es";

function jsdom(code)
{
  let div = document.createElement("div");
  div.innerHTML = code;
  return div;
}

test.registerTests(
  [
    function()
    {
      let dom = jsdom("<html><body> \r\n\ra\r\n\r\n\r\nb\r\n\r\n\r\n\r\nc \r\nd");
      // jsdom removes \r while parsing.
      test.eq("a\r\n\r\nb\r\n\r\nc\r\nd", convertHtmlToPlainText(dom));
    }
  , function()
    {
      let dom;

      // coalescing
      dom = jsdom("a  \u00A0\t\r\nb\r\n");
      test.eq("a b\r\n", convertHtmlToPlainText(dom));
    }

  , function()
    {
      let dom = jsdom("a<br>b");
      // jsdom removes \r...
      test.eq("a\r\nb", convertHtmlToPlainText(dom));
    }
  , function()
    {
      let dom = jsdom("<body><style>a</style></body>");
      test.eq("", convertHtmlToPlainText(dom));
    }
  , function()
    {
      let dom = jsdom("<body><title>a</title></body>");
      test.eq("", convertHtmlToPlainText(dom));
    }
  , function()
    {
      let dom;

      dom = jsdom("<a href='http://a'>a</a>");
      test.eq("a", convertHtmlToPlainText(dom));

      dom = jsdom("<a href='http://a/'>a</a>");
      test.eq("a", convertHtmlToPlainText(dom));

      dom = jsdom("<a href='http://a'>b</a>");
      test.eq("b <URL:http://a>", convertHtmlToPlainText(dom));

      dom = jsdom("<a href='http://a'>b</a>");
      test.eq("b", convertHtmlToPlainText(dom, { suppress_urls: true }));

      dom = jsdom("<a href='mailto:a'>a</a>");
      test.eq("a", convertHtmlToPlainText(dom));

      dom = jsdom("<a href='a'>a</a>");
      test.eq("a", convertHtmlToPlainText(dom));
    }
  , function()
    {
      let dom;

      dom = jsdom("<img alt='' />");
      test.eq("", convertHtmlToPlainText(dom));

      dom = jsdom("<img alt='alt' />");
      test.eq("[alt]", convertHtmlToPlainText(dom));

      dom = jsdom("<img alt='alt' />");
      test.eq("[[alt]", convertHtmlToPlainText(dom, { imagehandling: 1 }));

      // legacy parameters
      dom = jsdom("<img alt='alt' />");
      test.eq("[[alt]", convertHtmlToPlainText(dom, 1));
    }
  , function()
    {
      let dom;

      dom = jsdom("<ul><li>a</li><li>b</li></ul>");
      test.eq("* a\r\n* b", convertHtmlToPlainText(dom));

      dom = jsdom("<ol><li>a</li><li>b</li></ol>");
      test.eq("1. a\r\n2. b", convertHtmlToPlainText(dom));

      dom = jsdom("<ol><li>a</li><li value='3'>b</li><li>c</li></ol>");
      test.eq("1. a\r\n3. b\r\n4. c", convertHtmlToPlainText(dom));

      dom = jsdom("<ol><li>a</li><li value='invalid'>b</li><li>c</li></ol>");
      test.eq("1. a\r\n2. b\r\n3. c", convertHtmlToPlainText(dom));

      dom = jsdom("<ol start='2'><li>a</li></ol>");
      test.eq("2. a", convertHtmlToPlainText(dom));

      dom = jsdom("<ol start='-1'><li>a</li></ol>");
      test.eq("1. a", convertHtmlToPlainText(dom));
    }
  , function()
    {
      let dom;

      dom = jsdom("<table><tr><th>a</th><td>b</td></tr><tr><td>c</td><td>d</td></tr>");
      test.eq("a\tb\r\nc\td\r\n", convertHtmlToPlainText(dom));

      dom = jsdom("<table><tr><td><ul><li>a</li></ul></td></tr>");
      test.eq("* a\r\n", convertHtmlToPlainText(dom));
    }
  ]);
