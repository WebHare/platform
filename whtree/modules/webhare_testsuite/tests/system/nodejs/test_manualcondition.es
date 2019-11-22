"use strict";
/* global describe it */ // mocha test

const ManualCondition = require("@mod-system/js/internal/util/manualcondition.es");
const assert = require('assert');

describe("Initial state", function()
{
  let mc = new ManualCondition;

  it("is not signalled according to waitSignalled", function(callback)
  {
    let fulfilled = false;
    mc.waitSignalled().then(() => fulfilled = true);

    setTimeout(() =>
    {
      assert(!fulfilled, "Initial state is immediately signalled according to waitSignalled");
      callback();
    }, 20);
  });

  it("is not signalled according to waitNotSignalled", function(callback)
  {
    let fulfilled = false;
    mc.waitNotSignalled().then(() => fulfilled = true);

    setTimeout(() =>
    {
      assert(fulfilled, "Initial state is immediately signalled according to waitNotSignalled");
      callback();
    }, 20);
  });
});

describe("Going from not signalled to signalled", function()
{
  let mc = new ManualCondition;

  it("fulfills the wait promise", function(callback)
  {
    let fulfilled = false;
    mc.waitSignalled().then(() => fulfilled = true);
    mc.setSignalled(true);

    setTimeout(() =>
    {
      assert(fulfilled, "Previous wait promise isn't resolved when the condition becomes signalled");
      callback();
    }, 20);
  });

  it("stays signalled after that", function(callback)
  {
    let fulfilled = false;
    mc.waitSignalled().then(() => fulfilled = true);

    setTimeout(() =>
    {
      assert(fulfilled, "Wait promise isn't resolved immediately when the condition is signalled");
      callback();
    }, 20);
  });
});

describe("Going from signalled to not signalled", function()
{
  let mc = new ManualCondition;
  mc.setSignalled(true);

  it("fulfills the wait promise", function(callback)
  {
    let fulfilled = false;
    mc.waitNotSignalled().then(() => fulfilled = true);
    mc.setSignalled(false);

    setTimeout(() =>
    {
      assert(fulfilled, "Previous non-signalled wait promise is resolved when the condition becomes unsignalled");
      callback();
    }, 20);
  });


  it("stays unsignalled after that", function(callback)
  {
    let fulfilled = false;
    mc.waitNotSignalled().then(() => fulfilled = true);

    setTimeout(() =>
    {
      assert(fulfilled, "Non-signalled wait promise isn't immediately resolved when the condition is unsignalled");
      callback();
    }, 20);
  });
});
