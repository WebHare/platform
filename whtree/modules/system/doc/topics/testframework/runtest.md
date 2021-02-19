# Testframework

## Setting up tests
WebHare can automatically run tests placed in the `tests/` directory of a module.
This directory needs to contain a `testinfo.xml` explaining which test to run, eg:

```xml
<group xmlns="http://www.webhare.net/xmlns/system/testinfo">
  <test script="test_beer.whscr" />
</group>
```

`<test script=` refers to a [HareScript test](harescript.md).

You can parameterize tests if you want to run the same test under different circumstances. Eg a webshop may use this
to run tests with prices both including and excluding VATs:

```xml
  <jstest name="test-checkout-euvat-pricesincludevat" file="test-checkout-euvat.es">
     <arg value="includevat"/>
  </jstest>
  <jstest name="test-checkout-euvat-pricesexcludevat" file="test-checkout-euvat.es">
     <arg value="excludevat"/>
  </jstest>
```

The value of test parameter can be queried using `getTestArgument(idx)`

## Running WebHare with testsuite
We now supply a build which embeds the webhare_testsuite (for safety reasons,
normal builds omit this). To start it:

```bash
docker pull webhare/webhare-core:master-withts
docker run --rm -p 8989:8000 webhare/webhare-core:master-withts
```

this will create a testsuite server with its administrative interface on port 8989.
Go to http://127.0.0.1:8989/ to access it.

## Simulating CI
```bash
wh builddocker
NOCLEANUP=1 wh testdocker
```

NOCLEANUP=1 prevents the test container from being stopped and removed at the end of
the testrun, so you have a chance to inspect it.

## Manually running a test on the Docker image
When CI tests fail, you may want to reproduce the testenvironment as much
as possible.

To do this, find the name of the image you want to test. If you've built the image locally
(eg you've run `wh builddocker`) the image will be named `webhare/webhare-extern:localbuild-withts`.

If you want to test against a CI built version,
you're probably after `webhare/webhare-core:master-withts`. If you didn't build
it locally, pull it first: `docker pull webhare/webhare-core:master-withts`
to make sure you have the newset version

Launch a test image in the foreground:
```bash
docker run -p 8000 --rm --name webhare-test -ti \
  -v ~/projects/webhare/whtree/modules/webhare_testsuite:/opt/whmodules/webhare_testsuite \
  gitlab-registry.webhare.com/webhare/webhare:master-b7748faf2b50d85ccfad1bd0b47aadc5b4c0f167-withts
```

Then, in a second console (you may want to skip the `wh setupdev` to get a
more pristine test environment)
```bash
docker exec webhare-test wh preptestsuite
docker exec -ti webhare-test wh setupdev
docker exec webhare-test wh softreset
docker exec webhare-test wh runtest <name of the failed test>
```

To enter the test image:
```bash
docker exec -ti webhare-test /bin/bash
```

## Running tests with docker

Running coverage tests for a single test
```bash
wh builddocker
wh testdocker --coverage <testname>
```

## Running tests locally

Running frontend (Chrome) tests on Linux
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debugged --disk-cache-dir=/dev/null
wh runtest --chromeurl http://localhost:9222 system.setup.setup-standard
```

Running frontend (Chrome) tests on OSX
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debugged --disk-cache-dir=/dev/null
wh runtest --chromeurl http://localhost:9222 TESTNAME
```

You can add `--keepsessions` to runtest to prevent browser windows from closing
after completing or failing a test
