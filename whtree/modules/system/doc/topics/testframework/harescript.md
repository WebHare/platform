# Testfw
How to use the testframework, and best practices.

In generally, tests only clean up data from previous tests when a new test is
started - both failed and succesful tests will leave data lingering to allow
easy development of further tests

## Skeleton for a new test
```harescript
LOADLIB "module::system/testframework.whlib";

MACRO TestXX()
{
}

RunTestFramework([ PTR TestXX
                 ]);
```

## General guidelines
- Try to test one thing at a time - if you need to know if eg `<select>`
  properly validates the 'rowkey' parameter, it's overkill to setup an
  asynchronous Tollium test - just use the generic compont testscreen.

## WHFS ing
If you don't specifically need a clean site, use the `testfw->tempfolder` - it
is cleared at the start of every test

## Tollium
The screen `webhare_testsuite:tests/component.generictest` can be used for
most component tests. Search for that name to find examples.

The testframework marks all XML screen members as public as if public=true
was set on every element. This allows you to LoadScreen() and still access
all the components.

Tollium applications can also be tested using asynchronous code. If you don't
need the asynchronous code (ie, your code won't cause modal dialogs to open
and you're not interested in testing the todd/tollium communication), it's best
to keep your tests synchronous by just using LoadScreen.
