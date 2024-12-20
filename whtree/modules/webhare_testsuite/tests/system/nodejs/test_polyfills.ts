/*
To test for the backend (faster!):
wh runtest system.nodejs.test_polyfills_backend

In the browser:
wh runtest system.nodejs.test_polyfills_frontend
https://my.webhare.dev/.system/jstests/?site=webhare_testsuite.testsite&mask=system.nodejs.test_polyfills_frontend

We try to test for the presence of APIs we except to be present or polyfilled here so we can rely on them, eg the iterator proposals from https://caniuse.com/?search=iterator

You may need to run the frontend test version manually on older browsers where possible/available
*/

import * as test from "@webhare/test";

function* naturals() {
  let i = 0;
  while (true) {
    yield i;
    i += 1;
  }
}
function testIterators() {
  //tests taken from https://github.com/tc39/proposal-iterator-helpers/

  { //map
    const result = naturals()
      .map(value => {
        return value * value;
      });

    test.eq({ value: 0, done: false }, result.next());
    test.eq({ value: 1, done: false }, result.next());
    test.eq({ value: 4, done: false }, result.next());
  }

  { //filter
    const result = naturals()
      .filter(value => {
        return (value % 2) === 0;
      });

    test.eq({ value: 0, done: false }, result.next());
    test.eq({ value: 2, done: false }, result.next());
    test.eq({ value: 4, done: false }, result.next());
  }

  { //take
    const result = naturals()
      .take(3);
    test.eq({ value: 0, done: false }, result.next());
    test.eq({ value: 1, done: false }, result.next());
    test.eq({ value: 2, done: false }, result.next());
    test.eq({ value: undefined, done: true }, result.next());
  }

  { //drop
    const result = naturals()
      .drop(3);
    test.eq({ value: 3, done: false }, result.next());
    test.eq({ value: 4, done: false }, result.next());
    test.eq({ value: 5, done: false }, result.next());
  }

  { //flatMap
    const sunny = ["It's Sunny in", "", "California"].values();

    const result = sunny
      .flatMap(value => value.split(" ").values());
    test.eq({ value: "It's", done: false }, result.next());
    test.eq({ value: "Sunny", done: false }, result.next());
    test.eq({ value: "in", done: false }, result.next());
    test.eq({ value: "", done: false }, result.next());
    test.eq({ value: "California", done: false }, result.next());
    test.eq({ value: undefined, done: true }, result.next());
  }

  { //reduce
    const result = naturals()
      .take(5)
      .reduce((sum, value) => {
        return sum + value;
      }, 3);
    test.eq(13, result);
  }

  { //toArray
    const result = naturals()
      .take(5)
      .toArray();
    test.eq([0, 1, 2, 3, 4], result);
  }

  { //forEach
    const log: number[] = [];
    const fn = (value: number) => log.push(value);
    const iter = [1, 2, 3].values();

    iter.forEach(fn);
    test.eq("1, 2, 3", log.join(", "));
  }

  { //some
    const iter = naturals().take(4);

    test.eq(true, iter.some(v => v > 1));
    test.eq(false, iter.some(v => true));
    test.eq(true, naturals().take(4).some(v => v > 1));
    test.eq(true, naturals().take(4).some(v => v === 1));
  }

  { //every
    const iter = naturals().take(10);

    test.eq(true, iter.every(v => v >= 0));
    test.eq(true, iter.every(v => false));
    test.eq(false, naturals().take(4).every(v => v > 0));
    test.eq(true, naturals().take(4).every(v => v >= 0));
  }

  { //find
    test.eq(2, naturals().find(v => v > 1));
  }

  { //from
    class Iter {
      next() {
        return { done: false, value: 1 };
      }
    }

    const iter = new Iter();
    const wrapper = Iterator.from(iter);

    test.eq({ value: 1, done: false }, wrapper.next());
    test.eq([1, 1, 1], [...wrapper.take(3)]);
  }
}

test.runTests([
  // test the polyfill
  testIterators
]);
