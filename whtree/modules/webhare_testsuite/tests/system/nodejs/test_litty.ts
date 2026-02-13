import { isLitty, litty, littyToString } from "@webhare/litty";
import * as test from "@webhare/test";

function divComponent(inData: string) {
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
}

test.run([testLitty]);
