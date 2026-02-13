import { isLitty, litty, littyEncode, littyToString, type Litty } from "@webhare/litty";
import * as test from "@webhare/test";

function divComponent(inData: string | Litty) {
  return litty`<div>${inData}</div>`;
}

async function testLitty() {
  const templ = litty`<div>${"<test>"}</div>`;
  test.eq(`<div>&lt;test&gt;</div>`, await littyToString(templ));

  const templ2 = litty`<div>${templ}</div>`;
  test.eq(`<div><div>&lt;test&gt;</div></div>`, await littyToString(templ2));

  const templ3 = litty`<div>${[templ, templ2]}</div>`;
  test.eq(`<div><div>&lt;test&gt;</div><div><div>&lt;test&gt;</div></div></div>`, await littyToString(templ3));

  test.assert(isLitty(templ3));
  test.assert(!isLitty(null));
  test.assert(!isLitty("test3"));

  //Ensure we don't crash with: Cannot read properties of undefined (reading 'strings')
  //TODO better handling, and figure out how we want to deal with undefined values?
  //@ts-expect-error Litty doesn't like undefined
  test.eq(`<div><div></div></div>`, await littyToString(litty`<div>${divComponent(undefined)}</div>`));

  //We should default to attribute encoding
  test.eq(`<div>&lt;&apos;a&#10;b</div>`, await littyToString(divComponent("<'a\nb")));
  test.eq(`<div>&lt;&apos;a&#10;b</div>`, await littyToString(divComponent(littyEncode("<'a\nb", "attribute"))));
  //But allow users to select HTML encoding (where \n is translated into a <br. tag)
  test.eq(`<div>&lt;'a<br>b</div>`, await littyToString(divComponent(littyEncode("<'a\nb", "html"))));
}

test.run([testLitty]);
