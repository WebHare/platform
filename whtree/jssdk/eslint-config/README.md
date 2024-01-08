# WebHare eslint settings
Use this package if you want to match or base yourself on WebHare Platform's linting settings. Refer to this package in your .eslintrc.json `extends` setting

When using this package you will also need to add `@typescript-eslint/eslint-plugin`, `eslint-plugin-tsdoc` and `eslint-plugin-react` as a dependency as eslint will look up these
plugins relative to your .eslintrc.json. (https://eslint.org/docs/latest/use/configure/plugins#configure-plugins)

So to fully install this module:
```bash
npm install --save-dev @webhare/eslint-config @typescript-eslint/eslint-plugin@latest eslint-plugin-react@latest eslint-plugin-tsdoc@latest
```

and make sure your `.eslintrc.json` contains at leadt:

```
{
    "extends": "@webhare/eslint-config"
}
```
