/* global describe it */
"use strict";

const WaitableTimer = require("@mod-system/js/internal/util/waitabletimer.es");
const assert = require("assert");

describe("Initial state", function()
{
  let timer = new WaitableTimer;

  it("is not signalled according to waitSignalled", function(callback)
  {
    let fulfilled = false;
    timer.waitSignalled().then(() => fulfilled = true);

    setTimeout(() =>
    {
      assert(!fulfilled, "Initial state is immediately signalled according to waitSignalled");
      callback();
    }, 10);
  });

  it("is not signalled according to waitNotSignalled", function(callback)
  {
    let fulfilled = false;
    timer.waitNotSignalled().then(() => fulfilled = true);

    setTimeout(() =>
    {
      assert(fulfilled, "Initial state is immediately signalled according to waitNotSignalled");
      callback();
    }, 10);
  });
});

describe("Basic manipulation", function()
{
  it("isn't immediately signalled after setting", function(callback)
  {
    let timer = new WaitableTimer;

    let fulfilled = false;
    timer.reset(20);
    timer.waitSignalled().then(() => fulfilled = true);

    setTimeout(() =>
    {
      assert(!fulfilled, "Is immediately fulfilled when a timer was set");
      callback();
    }, 10);
  });

  it("becomes signalled after a time", function(callback)
  {
    let timer = new WaitableTimer;

    let fulfilled = false;
    timer.reset(10);
    timer.waitSignalled().then(() => fulfilled = true);

    setTimeout(() =>
    {
      assert(fulfilled, "Is not fulfulled after the timer expired");
      callback();
    }, 20);
  });

  it("stays signalled after expiring", function(callback)
  {
    let timer = new WaitableTimer;

    let fulfilled = false;
    timer.reset(10);

    setTimeout(() =>
    {
      timer.waitSignalled().then(() => fulfilled = true);
    }, 20);

    setTimeout(() =>
    {
      assert(fulfilled, "Doesn't stay fulfilled after timer expire");
      callback();
    }, 25);
  });

  it("becomes unsignalled after resetting", function(callback)
  {
    let timer = new WaitableTimer;

    let fulfilled = false;
    timer.reset(10);

    setTimeout(() =>
    {
      timer.reset(10);
      timer.waitSignalled().then(() => fulfilled = true);

      setTimeout(() =>
      {
        assert(!fulfilled, "Doesn't stay fulfilled after timer expire");
      }, 5);

      setTimeout(() =>
      {
        assert(fulfilled, "Doesn't become signalled after reset");
        callback();
      }, 15);
    }, 20);
  });
});
