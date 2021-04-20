# Using NPM with WebHare

You can use NPM to download JavaScript modules to use when developing websites
in WebHare.

Most commands should be executed in the root of your design, eg:
`whcd mymodule/webdesigns/mydesign`

## Updating/installing dependencies on new modules
You can use `npm install <module>` to install modules, eg `npm install jquery`.
You should execute this command either from your module or your webdesign
root directory (both already contain the necessary `package.json` file if you
created the module and webdesign using `wh module`)

Packages loaded at the module level are available to all webdesigns in this
module (per the normal `node_modules` lookup rules).

Please note that a WebHare webdesign never needs to explicitly install `dompack`
as this package is automatically provided by the assetpack builder (and will
replace any user-supplied dompack anyway)

### Example: jQuery
To add jQuery, run this on your command line:

```bash
whcd mymodule/webdesigns/mydesign # go to your design directory
npm install jquery # install the dependency
```

and then in your JavaScript code:

```javascript
import $ from 'jquery';
$.ready(...);
```

### Example: font-awesome
To add FontAwesome, run this on your command line:

```bash
whcd mymodule/webdesigns/mydesign
npm install font-awesome@4
```

and then add to your JavaScript code:

```javascript
import 'font-awesome/css/font-awesome.css';
```

Note that we generally recommend to use JavaScript `import` for CSS files and
not `@import` as the former allows Webpack to de-duplicate the CSS import.

## Developing your own modules
If you want to develop your own modules (for use with WebHare or to also
share them with the wider npm ecosystem) you can use 'npm link' as you would
with non WebHare modules.

Set up a separate project for your upcoming NPM module:
```bash
mkdir ~/projects/myproject
cd ~/projects/myproject
git init
npm init
npm link
```

And from your project
```bash
npm link myproject
```

When you're done, commit and push your project to npm
```bash
git remote add origin git@gitlab.com:mynamespace/myproject.git
git add .
git commit
npm publish --public
git push -u origin master
```

And before committing your module, 'properly' refer to your project (and undo the link)
```bash
npm install myproject@^0.1.0
```

## Shipped node_modules
WebHare ships with some node_modules of its own to implement various funtionality (eg bundling). These NPM modules
are stored in whtree/node_modules and only accessible to built-in modules to prevent accidental undeclared dependencies
