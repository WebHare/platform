import { isLitty, litty, littyToString } from "@webhare/litty";
import * as test from "@webhare/test";

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
}

test.run([testLitty]);
