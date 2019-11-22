const fs = require('fs');
const process = require('process');
const bridge = require('@mod-system/js/wh/bridge');
const StackTrace = require('stack-trace');

let getopt = require('node-getopt').create([
  [''  , 'debug'               , 'debug output.'],
  [''  , 'worker=ARG'          , 'set worker number'],
  [''  , 'cluster=ARG'         , 'worker cluster'],
  ['h' , 'help'                , 'display this help'],
])              // create Getopt instance
.bindHelp()     // bind option 'help' to default action
.parseSystem(); // parse command line

let workerid = parseInt(getopt.options.worker);
let debug = !!getopt.options.debug;

class TaskContext
{
  constructor(persistentcache)
  {
    this.resolution = null;
    this.persistentcache = persistentcache;
  }
  resolveByRestart(when)
  {
    throw new Error("JS tasks cannot use resolveByRestart");
  }
  resolveByCompletion(result)
  {
    this.resolution = { type: "finished", result };
  }
}

/*
async function printResult(result)
{
  let outdata = JSON.stringify(result);

  // console.log and process.stdout.write only output 64kb of data, so we need to print in parts
  let partsize = 32768;
  for (let i = 0; i < outdata.length; i += partsize)
  {
    let part = outdata.substr(i, partsize);
    let writeval = process.stdout.write(part); // console.log adds newlines

    if (!writeval)
      await new Promise(resolve => process.stdout.once("drain", () => resolve()));
  }
}*/

async function main()
{
  if(debug)
    console.log("JS worker #" + workerid + " starting");

  bridge.on("close", () => process.exit(13));
  await bridge.connect({ debug: debug});

  let managedqueuemgr = await bridge.openWebHareService("system:managedqueuemgr", workerid);

  if(debug)
    console.log("JS worker got queuemgr connection");
  await mainloop(managedqueuemgr);
  process.exit(0);
}

function checkIfModified(since)
{
  let isoutofdate = false;
  Object.keys(require.cache).forEach(path =>
  {
    let status;
    // Try-catch around getting the status, it throws on missing files (eg. module deleted)
    try
    {
      status = fs.statSync(path);
    }
    catch (e) {}

    if (!status || status.mtime.getTime() >= since && !isoutofdate)
    {
      if(debug)
        console.log(`Restarting because ${path} has been modified`);

      isoutofdate = true;
    }
  });

  return isoutofdate;
}

async function mainloop(managedqueuemgr)
{
  let lasttaskresult=null;
  let persistentcache = {};
  let loopstart = Date.now();

  while(true)
  {
    let taskinfo = await managedqueuemgr.GETTASK(lasttaskresult);
    if(!taskinfo)
    {
      console.log("Connection lost, exiting");
      return;
    }

    // Check if any file has been modified since starting the loop
    if (checkIfModified(loopstart))
    {
      await managedqueuemgr.ANNOUNCEOUTOFDATE();
      process.exit(0);
    }

    try
    {
      if(!taskinfo.isephemeral)
        throw new Error("Non-ephemeral JavaScript tasks are not supported");

      // Persistent cache configured for this task?
      let cache;
      let persistentcachekey = taskinfo.options && taskinfo.options.persistentcachekey;
      if (persistentcachekey)
      {
        cache = persistentcache[persistentcachekey];
        if (!cache)
          cache = persistentcache[persistentcachekey] = {};
      }

      let taskrunner = require(taskinfo.library);
      if (typeof taskrunner == "object" && taskrunner.default) //es6 syntax?
        taskrunner = taskrunner.default;

      let context = new TaskContext(cache);
      await taskrunner(context, taskinfo.data);
      if(!context.resolution)
        throw new Error("Task did not specify a resolution");

      lasttaskresult = { type: "taskdone"
                       , result: context.resolution.result
                       };
    }
    catch(e)
    {
      console.log("runephemeraltask got exception", e);
      let trace = StackTrace.parse(e).map(elt =>
          ({ func: elt.getFunctionName() || ""
           , line: elt.getLineNumber() || 1
           , col: elt.getColumnNumber() || 1
           , filename: elt.getFileName() || ""
           }));

      await managedqueuemgr.ANNOUNCETASKFAIL( { type: "taskfailed"
                                              , error: e.toString()
                                              , trace: trace
                                              , isfatal: false
                                              });
      //not trusting state after an exception, so restart
      process.exit(0);
    }
  }
}

if(! (workerid>0))
{
  console.log("Syntax: managedtaskworker [--debug] [--worker <num>]");
  process.exit(1);
}

main().catch(e =>
{
  console.error("Exception in main", e);
  process.exit(1);
});
