import { isLitty, litty, littyEncode, littyToString, type Litty, type LittyValue } from "@webhare/litty";
import { Money } from "@webhare/std";
import * as test from "@webhare/test";

function divComponent(inData: LittyValue) {
  return litty`<div>${inData}</div>`;
}

async function testLitty() {
  const templ = litty`<div>${"<test>"}</div>`;
  test.eq(`<div>&lt;test&gt;</div>`, await littyToString(templ));

  const templ2 = litty`<div>${templ}</div>`;
  test.eq(`<div><div>&lt;test&gt;</div></div>`, await littyToString(templ2));

  const templ3 = litty`<div>${[templ, templ2]}</div>`;
  test.eq(`<div><div>&lt;test&gt;</div><div><div>&lt;test&gt;</div></div></div>`, await littyToString(templ3));

  test.eq(`<div></div>`, await littyToString(divComponent(null)));
  test.eq(`<div></div>`, await littyToString(divComponent(undefined)));
  test.eq(`<div><div></div></div>`, await littyToString(litty`<div>${divComponent(undefined)}</div>`));
  const nullishParts: (Litty | null | undefined)[] = [null, undefined, litty`item`];
  test.eq(`<div>item</div>`, await littyToString(litty`<div>${nullishParts}</div>`));

  test.assert(isLitty(templ3));
  test.assert(!isLitty(null));
  test.assert(!isLitty("test3"));


  //We should default to attribute encoding
  test.eq(`<div>&lt;&apos;a&#10;b</div>`, await littyToString(divComponent("<'a\nb")));
  test.eq(`<div>&lt;&apos;a&#10;b</div>`, await littyToString(divComponent(littyEncode("<'a\nb", "attribute"))));
  //But allow users to select HTML encoding (where \n is translated into a <br. tag)
  test.eq(`<div>&lt;'a<br>b</div>`, await littyToString(divComponent(littyEncode("<'a\nb", "html"))));
}

async function testLittyValues() {
  const date = new Date("2026-10-29T12:34:56.789+02:00");
  const instant = Temporal.Instant.from("2026-10-29T10:34:56.123456789Z");
  const plainDate = Temporal.PlainDate.from("2026-10-29");
  const plainDateTime = Temporal.PlainDateTime.from("2026-10-29T12:34:56.123456789");
  const plainTime = Temporal.PlainTime.from("12:34:56.123456789");
  const zonedDateTime = Temporal.ZonedDateTime.from("2026-10-29T12:34:56.123456789+01:00[Europe/Amsterdam]");

  test.eq("<div>true false</div>", await littyToString(litty`<div>${true} ${false}</div>`));
  test.eq("<div>2026-10-29T10:34:56.789Z</div>", await littyToString(litty`<div>${date}</div>`));
  test.eq("<div>2026-10-29T10:34:56.123456789Z</div>", await littyToString(litty`<div>${instant}</div>`));
  test.eq("<div>2026-10-29</div>", await littyToString(litty`<div>${plainDate}</div>`));
  test.eq("<div>2026-10-29T12:34:56.123456789</div>", await littyToString(litty`<div>${plainDateTime}</div>`));
  test.eq("<div>12:34:56.123456789</div>", await littyToString(litty`<div>${plainTime}</div>`));
  test.eq("<div>2026-10-29T12:34:56.123456789+01:00[Europe/Amsterdam]</div>", await littyToString(litty`<div>${zonedDateTime}</div>`));

  test.eq(
    "<div>truefalse2026-10-29T10:34:56.789Z2026-10-29T10:34:56.123456789Z2026-10-292026-10-29T12:34:56.12345678912:34:56.1234567892026-10-29T12:34:56.123456789+01:00[Europe/Amsterdam]&lt;&apos;a&#10;b0<span>nested</span></div>",
    await littyToString(litty`<div>${[true, false, date, instant, plainDate, plainDateTime, plainTime, zonedDateTime, ["<'a\nb", 0, null, undefined, litty`<span>nested</span>`]]}</div>`)
  );
}

async function testLittyAdditionalValues() {
  const url = new URL("https://example.com/?a=1&b=2");
  const bigint = 9007199254740993123456789n;
  const money = new Money("-1234.56789");

  test.eq('<a href="https://example.com/?a=1&amp;b=2">link</a>', await littyToString(litty`<a href="${url}">link</a>`));
  test.eq("<div>9007199254740993123456789</div>", await littyToString(divComponent(bigint)));
  test.eq("<div>0 -42</div>", await littyToString(litty`<div>${0n} ${-42n}</div>`));
  test.eq("<div>-1234.56789</div>", await littyToString(divComponent(money)));
  test.eq("<div>0 12.5</div>", await littyToString(litty`<div>${new Money()} ${new Money("12.50")}</div>`));
  test.eq(
    "<div>https://example.com/?a=1&amp;b=2|9007199254740993123456789|-1234.56789</div>",
    await littyToString(litty`<div>${[url, "|", [bigint, "|", money]]}</div>`)
  );
}

test.runTests([testLitty, testLittyValues, testLittyAdditionalValues]);
