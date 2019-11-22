/* globals describe it */

const { limitUTF8Length } = require("@mod-system/js/internal/utf8.es");
const assert = require("assert");

describe("UTF-8 length limiter", () =>
{
  it("works on ascii", () =>
  {
    assert.equal("",     limitUTF8Length("", 0));
    assert.equal("",     limitUTF8Length("", 1));
    assert.equal("",     limitUTF8Length("", 2));

    assert.equal("",     limitUTF8Length("a", 0));
    assert.equal("a",    limitUTF8Length("a", 1));
    assert.equal("a",    limitUTF8Length("a", 2));

    assert.equal("",     limitUTF8Length("ab", 0));
    assert.equal("a",    limitUTF8Length("ab", 1));
    assert.equal("ab",   limitUTF8Length("ab", 2));
    assert.equal("ab",   limitUTF8Length("ab", 3));

    assert.equal("",     limitUTF8Length("abc", 0));
    assert.equal("a",    limitUTF8Length("abc", 1));
    assert.equal("ab",   limitUTF8Length("abc", 2));
    assert.equal("abc",  limitUTF8Length("abc", 3));
  });

  it("works on 2-byte utf-8 chars", () =>
  {
    assert.equal("",     limitUTF8Length("", 0));
    assert.equal("",     limitUTF8Length("", 1));
    assert.equal("",     limitUTF8Length("", 2));

    assert.equal("",     limitUTF8Length("", 0));
    assert.equal("",     limitUTF8Length("ë", 1));
    assert.equal("ë",    limitUTF8Length("ë", 2));

    assert.equal("",     limitUTF8Length("ëë", 0));
    assert.equal("",     limitUTF8Length("ëë", 1));
    assert.equal("ë",    limitUTF8Length("ëë", 2));
    assert.equal("ë",    limitUTF8Length("ëë", 3));
    assert.equal("ëë",   limitUTF8Length("ëë", 4));

    assert.equal("",     limitUTF8Length("ëëë", 0));
    assert.equal("",     limitUTF8Length("ëëë", 1));
    assert.equal("ë",    limitUTF8Length("ëëë", 2));
    assert.equal("ë",    limitUTF8Length("ëëë", 3));
    assert.equal("ëë",   limitUTF8Length("ëëë", 4));
    assert.equal("ëë",   limitUTF8Length("ëëë", 5));
    assert.equal("ëëë",  limitUTF8Length("ëëë", 6));

    assert.equal("",     limitUTF8Length("", 0));
    assert.equal("",     limitUTF8Length("", 1));
    assert.equal("",     limitUTF8Length("", 2));

    assert.equal("",     limitUTF8Length("", 0));
    assert.equal("",     limitUTF8Length("ë", 1));
    assert.equal("ë",    limitUTF8Length("ë", 2));

    assert.equal("",     limitUTF8Length("ëë", 0));
    assert.equal("",     limitUTF8Length("ëë", 1));
    assert.equal("ë",    limitUTF8Length("ëë", 2));
    assert.equal("ë",    limitUTF8Length("ëë", 3));
    assert.equal("ëë",   limitUTF8Length("ëë", 4));

    assert.equal("",     limitUTF8Length("ëëë", 0));
    assert.equal("",     limitUTF8Length("ëëë", 1));
    assert.equal("ë",    limitUTF8Length("ëëë", 2));
    assert.equal("ë",    limitUTF8Length("ëëë", 3));
    assert.equal("ëë",   limitUTF8Length("ëëë", 4));
    assert.equal("ëë",   limitUTF8Length("ëëë", 5));
    assert.equal("ëëë",  limitUTF8Length("ëëë", 6));
  });

  it("works on 3-byte utf-8 chars", () =>
  {
    assert.equal("",                    limitUTF8Length("\uffff\uffff\uffff\uffff", 0));
    assert.equal("",                    limitUTF8Length("\uffff\uffff\uffff\uffff", 1));
    assert.equal("",                    limitUTF8Length("\uffff\uffff\uffff\uffff", 2));
    assert.equal("\uffff",              limitUTF8Length("\uffff\uffff\uffff\uffff", 3));
    assert.equal("\uffff",              limitUTF8Length("\uffff\uffff\uffff\uffff", 4));
    assert.equal("\uffff",              limitUTF8Length("\uffff\uffff\uffff\uffff", 5));
    assert.equal("\uffff\uffff",        limitUTF8Length("\uffff\uffff\uffff\uffff", 6));
    assert.equal("\uffff\uffff",        limitUTF8Length("\uffff\uffff\uffff\uffff", 7));
    assert.equal("\uffff\uffff",        limitUTF8Length("\uffff\uffff\uffff\uffff", 8));
    assert.equal("\uffff\uffff\uffff",  limitUTF8Length("\uffff\uffff\uffff\uffff", 9));
  });
});

