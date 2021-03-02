WARNING: this documentation was written when dompack was a separate module and may be out of date

# Running tests
We try to standardize dompack-related module test as much as possible.

You need `@webhare/dompack-builder` to run tests. dompack-builder should be a devDependency
of whatever package you're testing, and be installable by running `npm install`.

## Setting up a webserver
Most tests will not work with `file:///` URLs, so you need to arrange for
hosting of your projects folder, ie. your checked out modules need to be reachable
over http(s).

In WebHare, set up an access rule eg `/projects/` as an initial match, select
an alternative content source and choose your projects folder on disk. Other
webservers should offer some sort of virtual folder setting to do this.

If you don't have a webserver, consider the http-server package:
```
npm install -g http-server
http-server -p 8080 ~/projects/
```


## Running tests
Make sure you've run `npm install` in the root of the module you want to test.

Running `npm run watchtests` in the root of a module should launch the tests,
and you should be able to visit them by accessing the /tests/ subfolder

## Example: dompack-overlays tests
This assumes dompack-overlays is available as http://127.0.0.1:8080/dompack-overlays
(as `http-server` above would do) and is installed into `~/projects/dompack-overlays`

```
cd ~/projects/dompack-overlays
npm i --no-save
npm run watchtests
```

If you see 'All built' and no other errors, the tests and examples are live.
Open http://127.0.0.1:8080/dompack-overlays/tests/ (or whatever URL you've set up)

# Setting up automatic testing
The standard dompack-like setup uses an 'examples' folder to show off the module,
a 'tests' folder to run actual tests (which preferably use the examples for their tests)

First, setup dompack builder and dompack as devDepencies:

```bash
npm install --save-dev dompack
npm install --save-dev @webhare/dompack-builder
```

(note that dompack is a devDependency and possibly a peerDependency, but never
a true dependency for dompack projects)

## Setting up an example
You may still need to set up examples. A quick recipe:

`example/dompack.json`:
```json
{ "build": {
    "entrypoint": "example.es"
  }
}
```

`example/example.es`:
```javascript
import * as dompack from "dompack";
import "./example.scss";

//dompack.onDomReady(...)
```

`example/example.scss`:
```scss
* { margin: 0; }
```

`example/index.html`:
```html
<!DOCTYPE html>
<html>
  <head>
    <link href="dompackbuild/ap.css" rel="stylesheet">
    <script src="dompackbuild/ap.js"></script>
  </head>
  <body>
    Example!
  </body>
</html>
```

Add commands for the examples to package.json 'scripts' section:
```json
    "buildexamples": "node_modules/.bin/dompack-builder -r examples",
    "watchexamples": "node_modules/.bin/dompack-builder -rw examples",
```

Test/continue setting up the example.
```bash
npm run watchexamples
```

Now you should be able to visit your projects on your local test url, eg
https://my.webhare.dev/projects/dompack-project/examples/

## Setting up the actual tests

Set up `tests/dompack.json`, eg:

```json
{ "build": {
    "tests": ["test_basic.es","test_advanced.es"]
  }
}
```

Set up a placeholder to run the tests, `tests/index.html`
```html
<html>
  <head>
    <link href="dompackbuild/ap.css" rel="stylesheet"></link>
    <script src="dompackbuild/ap.js"></script>
  </head>
  <body>
  </body>
</html>
```

Build the actual tests, eg `test_basic.es`:
```javascript
import * as test from "dompack/testframework";

test.addTests(
[ "API and moving test"
, async function()
  {
    await test.loadPage('../../../examples/index.html');
    test.eq(3, test.qSA('.myoverlay').length);
  }
]);
```

Add testing commands to package.json 'scripts' section:
```json
    "test": "node_modules/.bin/dompack-builder -rt examples tests && eslint --ext .es,.js .",
    "watchtests": "node_modules/.bin/dompack-builder -rw examples tests"
```

Now you should be able to visit your tests on your local test url, eg
https://my.webhare.dev/projects/dompack-project/tests/dompackbuild/tests.html

## Setup Gitlab CI

Create a `.gitlab-ci.yml` file in the root of the project and set it to:

```yaml
include: https://build.webhare.dev/ci/gitlab-dompack-tests.yaml
```
