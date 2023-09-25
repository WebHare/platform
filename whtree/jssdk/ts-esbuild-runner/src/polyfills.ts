// Set up dispose symbols - https://github.com/evanw/esbuild/pull/3192 "you'll need to polyfill Symbol.dispose if it's not present before you use it.

//@ts-ignore -- It's marked readonly
Symbol.dispose ||= Symbol.for('Symbol.dispose');
//@ts-ignore -- It's marked readonly
Symbol.asyncDispose ||= Symbol.for('Symbol.asyncDispose');
