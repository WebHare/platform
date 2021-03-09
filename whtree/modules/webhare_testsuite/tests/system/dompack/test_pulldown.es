import * as test from "@mod-system/js/wh/testframework";
import * as dompack from "dompack";
import * as testhelpers from './testhelpers.es';

test.registerTests(
[ "Pulldown test"
, async function()
  {
    await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=pulldown');
  }
, async function()
  {
    let alwaysopendown_replacement = test.qS('#alwaysopendown').nextSibling;
    let ridiculous_replacement = test.qS('#ridiculous').nextSibling;
    test.eq(true, alwaysopendown_replacement.classList.contains('selectlist'));
    test.eq(true, ridiculous_replacement.classList.contains('selectlist'));
    test.eq(false, test.canClick(alwaysopendown_replacement.querySelector('.selectlist__items')));

    test.eq(0,alwaysopendown_replacement.getBoundingClientRect().top);
    test.eq(0,ridiculous_replacement.getBoundingClientRect().top);
    let oldx=ridiculous_replacement.getBoundingClientRect().left;

    test.eq("Should always open down", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);
    test.false(alwaysopendown_replacement.querySelector(".selectlist__current").classList.contains("copyclass"), "We don't copy classes to current");
    test.false(alwaysopendown_replacement.querySelector(".selectlist__current").hasAttribute("data-wh-form-placeholder"), "We dont' copy dataset 1-on-1 to current either");
    test.eq("", alwaysopendown_replacement.querySelector(".selectlist__current").getAttribute("data-optionvalue"), "But we DO copy the option value to a different name");
    test.true(alwaysopendown_replacement.querySelector(".selectlist__current").hasAttribute("data-option-wh-form-placeholder"), "AND we copy any data attributes the option value to a different name #2");
    test.click(alwaysopendown_replacement); //opens

    test.eq(0,alwaysopendown_replacement.getBoundingClientRect().top);
    test.eq(0,ridiculous_replacement.getBoundingClientRect().top,'should stay at top if an unrelated pulldown opens');
    test.eq(Math.floor(oldx),Math.floor(ridiculous_replacement.getBoundingClientRect().left),'should stay at same x position if an unrelated pulldown opens');

    let visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq(3, visibleitems.length, 'exactly 3: selected disabled element shouldnt be there');

    var menu = testhelpers.getOpenSelectList();
    test.eq(alwaysopendown_replacement.getBoundingClientRect().left, menu.getBoundingClientRect().left, "left edge should align exactly, down to the semipixel");

    let waitforchange = test.waitForEvent(test.qS('#alwaysopendown'), 'change');
    test.click(visibleitems[1]); //closes it again
    await waitforchange;

    test.eq(false, test.canClick(menu));
    test.eq(true, dompack.contains(alwaysopendown_replacement, menu), 'the values menu should be inside the wh-pulldown');
    test.eq("2", test.qS('#alwaysopendown').value);
    test.eq("Two", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);
    test.eq("2", alwaysopendown_replacement.querySelector(".selectlist__current").getAttribute("data-optionvalue"), "Check option value copy");
    test.false(alwaysopendown_replacement.querySelector(".selectlist__current").hasAttribute("data-option-wh-form-placeholder"), "#2 is not the placeholder so the attribute should be gone again");

    test.eq(false, visibleitems[0].classList.contains("copyclass"), "copyclass did not get copied");
    test.eq(true, visibleitems[0].classList.contains("copy2"));
    test.eq(false, visibleitems[1].classList.contains("copy2"));

    test.click(alwaysopendown_replacement); //open again
    visibleitems = testhelpers.getSelectListVisibleItems();

    test.eq(false, test.qS("#togglethisclass").classList.contains("copytoggle"));
    test.eq(false, visibleitems[1].classList.contains("copytoggle"));

    test.click("#toggleclass");
    test.click(alwaysopendown_replacement); //open again

    test.eq(true, test.qS("#togglethisclass").classList.contains("copytoggle"));
    await test.wait( () => testhelpers.getSelectListVisibleItems()[1].classList.contains("copytoggle") === true);
    // test.eq(true, visibleitems[1].classList.contains("copytoggle"));

    test.click("#toggleclass");
    test.click(alwaysopendown_replacement); //open again

    test.eq(false, test.qS("#togglethisclass").classList.contains("copytoggle"));
    await test.wait( () => testhelpers.getSelectListVisibleItems()[1].classList.contains("copytoggle") === false);
  }
, 'Test value indication'
, async function()
  {
    let onepixelshortselect_replacement = test.qS('#onepixelshortselect').nextSibling;
    test.click(onepixelshortselect_replacement);
    var menu =  testhelpers.getOpenSelectList();
    test.eq(true, !!menu);
    let visibleitems = testhelpers.getSelectListVisibleItems();
    //test.eq(false, visibleitems[2].classList.contains("selectlist__item--hover"));
    test.eq(true, visibleitems[0].classList.contains("selectlist__item--selected"));
    test.sendMouseGesture([{ el: visibleitems[2] }]);
    //test.eq(true, visibleitems[2].classList.contains("selectlist__item--hover"));
    //test.eq(false, visibleitems[0].classList.contains("selectlist__item--hover"));

    test.click(onepixelshortselect_replacement); //close it
    menu =  testhelpers.getOpenSelectList();
    test.eq(false, !!menu, 'unable to close pulldown by reclicking it');
  }
, 'Test optgroups'
, async function()
  {
    let optgroupsselect = test.qS('#withoptgroups > select');
    let replacement = optgroupsselect.nextSibling;
    let items = replacement.querySelector('.selectlist__items');

    test.eq(9, items.childNodes.length); //there should be 9 items (2 optgroups + 7 options)
    test.eq(true, items.childNodes[0].classList.contains('selectlist__item'));
    test.eq(false, items.childNodes[0].classList.contains('selectlist__optgroup'));
    test.eq(false, items.childNodes[0].classList.contains('selectlist__item--ingroup'));
    test.eq(true, items.childNodes[0].classList.contains('copy-1'));
    test.eq('1', items.childNodes[0].dataset.copy);

    test.eq(false, items.childNodes[1].classList.contains('selectlist__item'));
    test.eq(true, items.childNodes[1].classList.contains('selectlist__optgroup'));
    test.eq(false, items.childNodes[1].classList.contains('selectlist__item--ingroup'));
    test.eq(true, items.childNodes[1].classList.contains('copy-2'));
    test.eq('2', items.childNodes[1].dataset.copy);

    test.eq(true, items.childNodes[2].classList.contains('selectlist__item'));
    test.eq(false, items.childNodes[2].classList.contains('selectlist__optgroup'));
    test.eq(true, items.childNodes[2].classList.contains('selectlist__item--ingroup'));
    test.eq(true, items.childNodes[2].classList.contains('copy-2a'));
    test.eq('2a', items.childNodes[2].dataset.copy);

    test.eq('1', optgroupsselect.value);

    replacement.click();
    test.eq(false, !!testhelpers.getOpenSelectList(), 'unable to open optgroup pulldown by clicking it');
    items.childNodes[5].click();

    test.eq('3b', optgroupsselect.value);
    test.eq(false, !!testhelpers.getOpenSelectList(), 'unable to close optgroup pulldown by clicking an option');

    optgroupsselect.value='3c';
    replacement.click();
    test.eq(false, items.childNodes[5].classList.contains('selectlist__item--selected'));
    test.eq(true,  items.childNodes[6].classList.contains('selectlist__item--selected'));
  }
, 'Test disabled'
, async function()
  {
    let ridiculous_replacement = test.qS('#ridiculous').nextSibling;
    test.click(ridiculous_replacement, {x:5});

    let menu = testhelpers.getOpenSelectList();
    test.eq('', test.qS('#ridiculous').value);
    test.eq(4, test.qSA(menu,'.selectlist__item').length);
    test.eq(true, test.qSA(menu,'.selectlist__item')[3].classList.contains('selectlist__item--disabled'));
    test.click(test.qSA(menu,'.selectlist__item')[3]);
    test.eq(true, !!testhelpers.getOpenSelectList(), 'pulldown should not close');
    test.eq('', test.qS('#ridiculous').value, 'disabled option should not be selected');

    let waitforchange = test.waitForEvent(test.qS('#ridiculous'), 'dompack:-internal-refreshed');
    test.qS('#ridiculous').options[3].disabled=false;
    await waitforchange;

    test.eq(false, test.qSA(menu,'.selectlist__item')[3].classList.contains('selectlist__item--disabled'));
  }
, 'Test rendering position'
, function()
  {
    let justenoughselect_replacement = test.qS('#justenoughselect').nextSibling;
    let onepixelshortselect_replacement = test.qS('#onepixelshortselect').nextSibling;
    test.click(justenoughselect_replacement);

    let justenoughmenu = testhelpers.getOpenSelectList();
    test.eq(true, justenoughselect_replacement.getBoundingClientRect().top < justenoughmenu.getBoundingClientRect().top, 'pulldown should be below us');
    test.eq(justenoughmenu.getBoundingClientRect().top, justenoughselect_replacement.getBoundingClientRect().bottom, 'pulldown top should match original control bottom');
    test.eq(true, test.canClick(testhelpers.getSelectListVisibleItems()[0]));

    test.click(onepixelshortselect_replacement);

    let onepixelshortmenu = testhelpers.getOpenSelectList();
    test.eq(true, onepixelshortselect_replacement.getBoundingClientRect().top > onepixelshortmenu.getBoundingClientRect().top, 'expecting onepixel short to open upwards');
    test.eq(onepixelshortselect_replacement.getBoundingClientRect().top, onepixelshortmenu.getBoundingClientRect().bottom, 'pulldown botom should match original control top');
    test.eq(true, test.canClick(testhelpers.getSelectListVisibleItems()[0]));

    test.eq(false, test.canClick(justenoughmenu), 'expected justenough menu to have disappeared now we clicked on onepixelshort');
  }
, 'Change value'
, async function()
  {
    let alwaysopendown_replacement = test.qS('#alwaysopendown').nextSibling;
    test.eq("Two", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);
    test.qS('#alwaysopendown').value="1";
    test.eq("One", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);
    test.qS('#alwaysopendown').selectedIndex=9999;
    test.eq(-1, test.qS('#alwaysopendown').selectedIndex);
    test.eq('', test.qS('#alwaysopendown').value);
    test.eq("\u00a0", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);
    test.qS('#alwaysopendown').selectedIndex=2;
    test.eq("Two", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);

    test.qS('#alwaysopendown').appendChild(dompack.create('option', {value:'boyband', textContent:'Five'}));
    test.qS('#alwaysopendown').value='boyband';
    test.eq('boyband', test.qS('#alwaysopendown').value);
    test.eq("Five", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);
    test.eq("Five", alwaysopendown_replacement.querySelector(".selectlist__item.selectlist__item--selected").textContent);

    test.qS('#alwaysopendown').value=2;
  }
, 'Change name'
, async function()
  {
    let alwaysopendown_replacement = test.qS('#alwaysopendown').nextSibling;
    test.eq("Two", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);

    let waitforchange = test.waitForEvent(test.qS('#alwaysopendown'), 'dompack:-internal-refreshed');
    test.qS('#alwaysopendown').options[2].textContent='Twee';
    await waitforchange;

    test.eq("Twee", alwaysopendown_replacement.querySelector(".selectlist__current").textContent, 'expected current to be Twee');
  }
, 'Modify pulldown'
, async function()
  {
    let ridiculous_replacement = test.qS('#ridiculous').nextSibling;
    test.eq("Should also open down", ridiculous_replacement.querySelector(".selectlist__current").textContent);

    let waitforchange = test.waitForEvent(test.qS('#ridiculous'), 'dompack:-internal-refreshed');
    test.click(test.qS('#fillridiculous'));
    await waitforchange;

    test.eq("Many", ridiculous_replacement.querySelector(".selectlist__current").textContent);
    test.click(ridiculous_replacement);

    let menu = testhelpers.getOpenSelectList();
    test.eq(true, menu.getBoundingClientRect().top == ridiculous_replacement.getBoundingClientRect().bottom, 'expecting menu to open downwards and be attached');
  }
, 'Ignore right mouse button'
, function()
  {
    let justenoughselect_replacement = test.qS('#justenoughselect').nextSibling;
    test.sendMouseGesture([ { el: justenoughselect_replacement, down: 2 }, { up:2 } ]);
    test.eq(false, !!testhelpers.getOpenSelectList());
  }
, 'Test keyboard nav'
, async function()
  {
    await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=pulldown');  //clean state

    let alwaysopendown_replacement = test.qS('#alwaysopendown').nextSibling;
    test.click(alwaysopendown_replacement);
    let visibleitems = testhelpers.getSelectListVisibleItems();
    test.click(visibleitems[1]);

    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq(0, visibleitems.length);

    test.eq("Two", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);

    await test.pressKey("ArrowDown");
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq(3,visibleitems.length);
    test.eq(true, visibleitems[1].classList.contains("selectlist__item--selected"));

    await test.pressKey("ArrowDown");
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq(false, visibleitems[1].classList.contains("selectlist__item--selected"));
    test.eq(true, visibleitems[2].classList.contains("selectlist__item--selected"));

    await test.pressKey("ArrowDown");
    test.eq(true, visibleitems[0].classList.contains("selectlist__item--selected"));

    await test.pressKey("ArrowUp");
    await test.pressKey("Enter");
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq(0, visibleitems.length);
    test.eq("Third item that should always be opening down", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);

    await test.pressKey(" ");  //space should also open
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq(true, visibleitems[2].classList.contains("selectlist__item--selected"));

    await test.pressKey("ArrowUp");
    await test.pressKey(" ");  //AND select
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq(0, visibleitems.length);
    test.eq("Two", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);

    await test.pressKey("ArrowUp"); //reopens!
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq(3, visibleitems.length);
    test.eq(true, visibleitems[1].classList.contains("selectlist__item--selected"));

    await test.pressKey("ArrowUp");
    test.eq(true, visibleitems[0].classList.contains("selectlist__item--selected"));

    await test.pressKey("Escape");
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq(0,visibleitems.length);

    await test.pressKey("ArrowDown"); //reopen
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq(3,visibleitems.length);
    test.eq(true, visibleitems[1].classList.contains("selectlist__item--selected")); //#1 was selected before escape, but escape undoes so we should be back at #2
    test.eq("Two", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);

    await test.pressKey("o"); //jump to 'One'
    test.eq(true, visibleitems[0].classList.contains("selectlist__item--selected"));
    test.eq("Two", alwaysopendown_replacement.querySelector(".selectlist__current").textContent, "textnav with open pulldown doesnt change selection");

    await test.pressKey("x"); //should have no effect
    test.eq(true, visibleitems[0].classList.contains("selectlist__item--selected"));

    await test.pressKey("t"); //jump to 'two'
    test.eq(true, visibleitems[1].classList.contains("selectlist__item--selected"));

    await test.pressKey("t"); //jump to 'Third'
    test.eq(true, visibleitems[2].classList.contains("selectlist__item--selected"));

    await test.pressKey("t"); //back to 'two'
    test.eq(true, visibleitems[1].classList.contains("selectlist__item--selected"));

    await test.pressKey("o");
    await test.pressKey(" ");
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq(0,visibleitems.length, 'nav is closed now');
    test.eq("One", alwaysopendown_replacement.querySelector(".selectlist__current").textContent, "selection updated by keyboard nowactive");

    await test.pressKey("t");
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq(0,visibleitems.length, 'nav is closed now');
    test.eq("Two", alwaysopendown_replacement.querySelector(".selectlist__current").textContent, "should have immediately changed to 'two'");
  }
, 'Scroll to selection'
, async function()
  {
    dompack.focus(test.qS('#ridiculousbottomselect'));
    let ridiculousbottomselect_replacement = test.qS('#ridiculousbottomselect').nextSibling;
    await test.pressKey("s");//jump to 'Six'
    test.eq("Six", ridiculousbottomselect_replacement.querySelector(".selectlist__current").textContent, "should have immediately changed to 'Six'");

    await test.pressKey(" ");//open it
    let visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq("Six", visibleitems[visibleitems.length-1].textContent, "last visible item should be Six");
    test.eq(true, test.canClick(visibleitems[visibleitems.length-1]), "and by truely clickable!");

    await test.pressKey("o"); //jumps to one
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq("One", visibleitems[0].textContent, "One should be visible (scrolled up into view)");

    await test.pressKey("s");//jump to 'Six'
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq("Six", visibleitems[visibleitems.length-1].textContent, "Six should be visible (scrolled down into view)");
  }

, 'Disablepulldown'
, async function()
  {
    await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=pulldown');  //clean state

    let alwaysopendown_replacement = test.qS('#alwaysopendown').nextSibling;
    test.eq(false, test.qS('#alwaysopendown').disabled,'control should still be enabled');
    test.eq(false, alwaysopendown_replacement.classList.contains("selectlist--disabled"),'replaced version should not be disabled yet');

    window.top.alwaysopendown=test.qS('#alwaysopendown');
    test.qS('#alwaysopendown').disabled = true;

    test.eq(false, !!testhelpers.getOpenSelectList(), 'menu should initially be invisible');
    test.click(alwaysopendown_replacement);
    test.eq(false, !!testhelpers.getOpenSelectList(), 'menu should still be invisible - we disabled the control before we clicked it');

    test.eq(true, test.qS('#alwaysopendown').disabled);

    //we cant use the waitforEvent mechanism: IE doesn't fire customevents on disabled elements
    await test.wait( function() { return test.qS('#alwaysopendown').nextSibling.classList.contains("selectlist--disabled"); } );
  }
, function()
  {
    let alwaysopendown_replacement = test.qS('#alwaysopendown').nextSibling;
    test.eq(true, alwaysopendown_replacement.classList.contains("selectlist--disabled"), 'disabled class should have followed using mutations');
  }
, 'Test reset'
, async function()
  {
    let onepixelshortselect = test.qS('#onepixelshortselect');
    onepixelshortselect.value = 3;
    test.eq('U_Three', onepixelshortselect.nextSibling.querySelector('.selectlist__current').textContent);
    test.qS('#onepixelshort').reset();
    await test.waitUIFree();
    test.eq('1', onepixelshortselect.value);
    test.eq('Upwards, one pixel short', onepixelshortselect.nextSibling.querySelector('.selectlist__current').textContent);
  }
, 'scrolling!'
, function()
  {
    test.click(test.qS('#scrollable'));
    test.getWin().scrollTo (0, test.getWin().innerHeight/2);

    let onepixelshortselect_replacement = test.qS('#onepixelshortselect').nextSibling;
    test.click(onepixelshortselect_replacement);
    var menu =  testhelpers.getOpenSelectList();
    test.eq(true, !!menu);

    test.eq(onepixelshortselect_replacement.getBoundingClientRect().bottom, menu.getBoundingClientRect().top, 'new menu should attach to bottom of #onepixelshortselect');
  }
, 'tab key'
, async function()
  {
    await test.pressKey("Tab");
    test.eq(false, !!testhelpers.getOpenSelectList(), "selectlist must close when tabbing away");

  }
]);
