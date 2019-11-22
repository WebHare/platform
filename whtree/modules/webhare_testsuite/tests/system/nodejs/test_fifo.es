"use strict";
/* global describe it */

const FIFO = require("@mod-system/js/internal/util/fifo.es");
const assert = require("assert");

describe("Initial state", function()
{
  let fifo = new FIFO;

  it("is not signalled according to waitSignalled", function(callback)
  {
    let fulfilled = false;
    fifo.waitSignalled().then(() => fulfilled = true);

    setTimeout(() =>
    {
      assert(!fulfilled, "Initial state is immediately signalled according to waitSignalled");
      callback();
    }, 20);
  });

  it("is not signalled according to waitNotSignalled", function(callback)
  {
    let fulfilled = false;
    fifo.waitNotSignalled().then(() => fulfilled = true);

    setTimeout(() =>
    {
      assert(fulfilled, "Initial state is immediately signalled according to waitNotSignalled");
      callback();
    }, 20);
  });

  it("does not return an element on shift", function()
  {
    assert.strictEqual(undefined, fifo.shift());
  });
});

describe("Basic manipulation", function()
{
 it("returns pushed elements in fifo order", function()
 {
   let fifo = new FIFO;
   fifo.push(1);
   fifo.push(2);

   assert.strictEqual(1, fifo.shift());
   assert.strictEqual(2, fifo.shift());
   assert.strictEqual(undefined, fifo.shift());
 });
});


describe("Going from not signalled to signalled when an element is pushed", function()
{
  let fifo = new FIFO;

  it("fulfills the wait promise", function(callback)
  {
    let fulfilled = false;
    fifo.waitSignalled().then(() => fulfilled = true);
    fifo.push(1);

    setTimeout(() =>
    {
      assert(fulfilled, "Previous wait promise isn't resolved on push");
      callback();
    }, 20);
  });

  it("stays signalled after that", function(callback)
  {
    let fulfilled = false;
    fifo.waitSignalled().then(() => fulfilled = true);

    setTimeout(() =>
    {
      assert(fulfilled, "Wait promise is not immediately resolved when not empty");
      callback();
    }, 20);
  });
});

describe("Going from signalled to not signalled", function()
{
  let fifo = new FIFO;
  fifo.push(1);

  it("fulfills the wait promise", function(callback)
  {
    let fulfilled = false;
    fifo.waitNotSignalled().then(() => fulfilled = true);
    assert.strictEqual(1, fifo.shift());

    setTimeout(() =>
    {
      assert(fulfilled, "Previous not-signalled wait promise isn't resolved when the fifo becomes empty");
      callback();
    }, 20);
  });

  it("stays unsignalled after that", function(callback)
  {
    let fulfilled = false;
    fifo.waitNotSignalled().then(() => fulfilled = true);

    setTimeout(() =>
    {
      assert(fulfilled, "Non-signalled wait promise is resolved when the fifo is empty");
      callback();
    }, 20);
  });
});
