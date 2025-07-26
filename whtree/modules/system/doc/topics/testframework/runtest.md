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
wh buildcontainer
NOCLEANUP=1 wh testcontainer
```

NOCLEANUP=1 prevents the test container from being stopped and removed at the end of
the testrun, so you have a chance to inspect it.

## Manually running a test on the Docker image
When CI tests fail, you may want to reproduce the testenvironment as much
as possible.

To do this, find the name of the image you want to test. If you've built the image locally
(eg you've run `wh buildcontainer`) the image will be named `webhare/webhare-extern:localbuild-withts`.

If you want to test against a CI built version,
you're probably after `webhare/webhare-core:master-withts`. If you didn't build
it locally, pull it first: `docker pull webhare/webhare-core:master-withts`
to make sure you have the newset version

Launch a test image in the foreground:
```bash
docker run -p 8000 --rm --name webhare-test -ti \
  -v ~/projects/webhare/whtree/modules/webhare_testsuite:/opt/whdata/installedmodules/webhare_testsuite \
  gitlab-registry.webhare.com/webhare/webhare:master-b7748faf2b50d85ccfad1bd0b47aadc5b4c0f167-withts
```

Then, in a second console

```bash
docker exec webhare-test wh webserver addport 8088
docker exec webhare-test wh webserver addbackend http://127.0.0.1:8088/
docker exec webhare-test wh webhare_testsuite:reset
docker exec webhare-test wh runtest <name of the failed test>
```

To enter the test image:
```bash
docker exec -ti webhare-test /bin/bash
```

## Running tests with docker

Running coverage tests for a single test
```bash
wh buildcontainer
# Run a coverage test, using the local builddocker result (-w local)
wh testcontainer -w local --coverage <testname>
# Run a single test directly, open a shell after the tests have run
wh testcontainer -w local --sh publisher-webdesign.testwebdesign-template
```

## Running tests locally

Looping publisher test until one fails
```bash
wh runtest --loop --breakonerror publisher.*
```

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

You can add `--keepopen` to runtest to prevent browser windows from closing
after completing or failing a test

## Setting up a discardable test environment
You may want to setup a separate WebHare installtion for running tests on a clean
system. A way to do this is to setup a shell script to control this separate
installation. Create an executable (chmod a+x) `wh-test` containing:

```bash
#!/bin/bash
export WEBHARE_NOINSTALLATIONINFO=1
export WEBHARE_DTAPSTAGE=development
export WEBHARE_DATAROOT=$HOME/projects/whdata/test/
export WEBHARE_BASEPORT=13300
exec wh "$@"
```

(this assumes a working `wh`, update the WEBHARE_DATAROOT as needed)

Run `wh-test dirs` to verify the configuration. You can now start this
separate installation with `wh-test console` and invoke tests using `wh-test runtest ...`

If you often reset this installation you can use `wh-test freshdbconsole`
to remove the database and start a console version. You will need to create
an empty file named `$WEBHARE_DATAROOT/etc/allow-fresh-db` once to verify you
really want to be able to run `freshdbconsole` on this installation.

You may want to preconfigure your development WebHare automatically, especially
if you often use `freshdbconsole`. Add the following line to your configuration file,
above the `exec wh` command:

```bash
export WEBHARE_POSTSTARTSCRIPT=${BASH_SOURCE%/*}/wh-test-startup.sh
```

And add the following content to an executable `wh-test-startup.sh` file to
always set up an interface on port 8888:

```bash
#!/bin/bash
if ! wh-test webserver addport 8888 2>/dev/null ; then
  echo "Looks like startup script has already run"
  exit 0
fi

echo "Setting up for tests"
wh-test webserver addbackend --primary http://localhost:8888/
wh-test webhare_testsuite:reset
wh-test users adduser --sysop --password secret sysop@example.net
exit 0
```

## Managing secrets
Secrets should be set in an environment variable named `TESTSECRET_<name>`
or configured using `wh debug setsecret "<name>=<value>"`. Tests can retrieve
these settings using %GetTestSecret and specifying thes secret. Values set using
`wh debug setsecret` apply globally to the currently running WebHare installation
and take precedence over any environment variables, but are lost after a restart.

During local development you should probably load sensitive secrets (eg AWS keys)
only through `wh debug setsecret` to prevent them from being in your environment at
all times. Integrate `wh debug setsecret` with a password manager to prevent
sensitive keys from being stored unencrypted on disk at all.
