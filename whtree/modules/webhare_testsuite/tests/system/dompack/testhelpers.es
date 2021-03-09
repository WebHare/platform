import * as test from "@mod-system/js/wh/testframework";

export function getOpenSelectList()
{
  return test.qSA('div').filter(node => Array.from(node.classList).some(name => name.match(/__items--open$/)))[0];
}
export function getSelectListVisibleItems()
{
  return test.qSA('.selectlist__items .selectlist__item').filter(node => test.canClick(node));
}

