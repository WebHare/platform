///@ts-ignore -- FIXME port utf8.es to TypeScript
import { limitUTF8Length } from "@mod-system/js/internal/utf8";
import * as test from "@webhare/test";

function testWorksOnAscii() {
  test.eq("", limitUTF8Length("", 0));
  test.eq("", limitUTF8Length("", 1));
  test.eq("", limitUTF8Length("", 2));

  test.eq("", limitUTF8Length("a", 0));
  test.eq("a", limitUTF8Length("a", 1));
  test.eq("a", limitUTF8Length("a", 2));

  test.eq("", limitUTF8Length("ab", 0));
  test.eq("a", limitUTF8Length("ab", 1));
  test.eq("ab", limitUTF8Length("ab", 2));
  test.eq("ab", limitUTF8Length("ab", 3));

  test.eq("", limitUTF8Length("abc", 0));
  test.eq("a", limitUTF8Length("abc", 1));
  test.eq("ab", limitUTF8Length("abc", 2));
  test.eq("abc", limitUTF8Length("abc", 3));
}

function testWorksOn2ByteChars() {

  test.eq("", limitUTF8Length("", 0));
  test.eq("", limitUTF8Length("", 1));
  test.eq("", limitUTF8Length("", 2));

  test.eq("", limitUTF8Length("", 0));
  test.eq("", limitUTF8Length("ë", 1));
  test.eq("ë", limitUTF8Length("ë", 2));

  test.eq("", limitUTF8Length("ëë", 0));
  test.eq("", limitUTF8Length("ëë", 1));
  test.eq("ë", limitUTF8Length("ëë", 2));
  test.eq("ë", limitUTF8Length("ëë", 3));
  test.eq("ëë", limitUTF8Length("ëë", 4));

  test.eq("", limitUTF8Length("ëëë", 0));
  test.eq("", limitUTF8Length("ëëë", 1));
  test.eq("ë", limitUTF8Length("ëëë", 2));
  test.eq("ë", limitUTF8Length("ëëë", 3));
  test.eq("ëë", limitUTF8Length("ëëë", 4));
  test.eq("ëë", limitUTF8Length("ëëë", 5));
  test.eq("ëëë", limitUTF8Length("ëëë", 6));

  test.eq("", limitUTF8Length("", 0));
  test.eq("", limitUTF8Length("", 1));
  test.eq("", limitUTF8Length("", 2));

  test.eq("", limitUTF8Length("", 0));
  test.eq("", limitUTF8Length("ë", 1));
  test.eq("ë", limitUTF8Length("ë", 2));

  test.eq("", limitUTF8Length("ëë", 0));
  test.eq("", limitUTF8Length("ëë", 1));
  test.eq("ë", limitUTF8Length("ëë", 2));
  test.eq("ë", limitUTF8Length("ëë", 3));
  test.eq("ëë", limitUTF8Length("ëë", 4));

  test.eq("", limitUTF8Length("ëëë", 0));
  test.eq("", limitUTF8Length("ëëë", 1));
  test.eq("ë", limitUTF8Length("ëëë", 2));
  test.eq("ë", limitUTF8Length("ëëë", 3));
  test.eq("ëë", limitUTF8Length("ëëë", 4));
  test.eq("ëë", limitUTF8Length("ëëë", 5));
  test.eq("ëëë", limitUTF8Length("ëëë", 6));
}

function testWorksOn3ByteChars() {
  test.eq("", limitUTF8Length("\uffff\uffff\uffff\uffff", 0));
  test.eq("", limitUTF8Length("\uffff\uffff\uffff\uffff", 1));
  test.eq("", limitUTF8Length("\uffff\uffff\uffff\uffff", 2));
  test.eq("\uffff", limitUTF8Length("\uffff\uffff\uffff\uffff", 3));
  test.eq("\uffff", limitUTF8Length("\uffff\uffff\uffff\uffff", 4));
  test.eq("\uffff", limitUTF8Length("\uffff\uffff\uffff\uffff", 5));
  test.eq("\uffff\uffff", limitUTF8Length("\uffff\uffff\uffff\uffff", 6));
  test.eq("\uffff\uffff", limitUTF8Length("\uffff\uffff\uffff\uffff", 7));
  test.eq("\uffff\uffff", limitUTF8Length("\uffff\uffff\uffff\uffff", 8));
  test.eq("\uffff\uffff\uffff", limitUTF8Length("\uffff\uffff\uffff\uffff", 9));
}

test.run([
  testWorksOnAscii,
  testWorksOn2ByteChars,
  testWorksOn3ByteChars
]);
