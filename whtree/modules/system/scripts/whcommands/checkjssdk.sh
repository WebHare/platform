#!/bin/bash

RETVAL=0

cd "$WEBHARE_DIR" || exit 1

if ! node_modules/.bin/eslint --config .eslintrc.json jssdk ; then
  echo "ERR! FATAL: jssdk does not pass eslint"
  RETVAL=1
fi
if ! node_modules/.bin/tsfmt --verify --no-tslint --no-editorconfig --no-vscode --useTsfmt tsfmt.json $(find jssdk -name "*.ts" -or -name "*.tsx") ; then
  echo "ERR! FATAL: jssdk does not pass tsfmt --verify"
  RETVAL=1
fi

exit $RETVAL
