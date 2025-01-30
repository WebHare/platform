import * as test from "@webhare/test";
import { WHManagerConnection, WHMProcessType, WHMRequestOpcode, type WHMResponse, WHMResponseOpcode } from "@mod-system/js/internal/whmanager/whmanager_conn";
import { readMarshalData, writeMarshalData, writeMarshalPacket } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getScriptName } from "@mod-system/js/internal/whmanager/bridge";


async function testRPCs() {
  const conn = new WHManagerConnection;

  let responses: WHMResponse[] = [];

  function haveResponse(opcode: WHMResponseOpcode) {
    return Boolean(responses.some(r => r.opcode === opcode));
  }

  async function extractResponses<T extends WHMResponseOpcode>(opcode: T): Promise<Array<WHMResponse & { opcode: T }>> {
    await test.wait(() => haveResponse(opcode), { timeout: 15000, annotation: `Expected a response RPC with opcode ${opcode}` });
    const retval = responses.filter(m => m.opcode === opcode) as Array<WHMResponse & { opcode: T }>;
    responses = responses.filter(m => m.opcode !== opcode);
    return retval;
  }

  conn.on("data", (response => responses.push(response)));

  // Wait for the connection to come online
  const ref = conn.getRef();
  let online = false, goterror = false;
  conn.on("online", () => online = true);
  conn.on("offline", () => goterror = true);
  await test.wait(() => online);


  const testdata = { testdate: new Date, int: 0, float: 1.5, str: "str", intarr: [1, 2] };

  // STORY: process registration & system config data update
  {
    conn.send({
      opcode: WHMRequestOpcode.RegisterProcess,
      pid: process.pid,
      type: WHMProcessType.TypeScript,
      name: getScriptName(),
      parameters: {}
    });

    const registerresults = await extractResponses(WHMResponseOpcode.RegisterProcessResult);
    test.eq(1, registerresults.length);

    conn.send({
      opcode: WHMRequestOpcode.SetSystemConfig,
      systemconfigdata: registerresults[0].systemconfigdata
    });

    const systemconfigupdatresults = await extractResponses(WHMResponseOpcode.SystemConfig);
    test.eq([
      {
        opcode: WHMResponseOpcode.SystemConfig,
        have_hs_debugger: registerresults[0].have_hs_debugger,
        have_ts_debugger: registerresults[0].have_ts_debugger,
        systemconfigdata: registerresults[0].systemconfigdata
      }
    ], systemconfigupdatresults);
  }

  // STORY: getprocesslist
  {
    conn.send({ opcode: WHMRequestOpcode.GetProcessList, requestid: 13 });
    const listresult = await extractResponses(WHMResponseOpcode.GetProcessListResult);
    test.eq(1, listresult.length);
    test.eq(13, listresult[0].requestid);
    test.assert(Array.from(listresult[0].processes.entries()).some(([, { name }]) => name === "whcompile"), "process 'whcompile' should be registered");
  }

  // STORY: event broadcast
  {
    // event bouncer with second connection
    const conn2 = new WHManagerConnection;
    let gotdata = false;
    conn2.on("data", (data) => {
      gotdata = true;
      if (data.opcode === WHMResponseOpcode.IncomingEvent && data.eventname === "webhare_testsuite:testevent") {
        conn2.send({
          opcode: WHMRequestOpcode.SendEvent,
          eventname: "webhare_testsuite:testeventbounce",
          eventdata: data.eventdata
        });
      }
    });
    conn2.getRef(); // leak the reference, see if conn2.close kills it
    await new Promise(resolve => conn2.on("online", resolve));

    conn2.send({ opcode: WHMRequestOpcode.RegisterProcess, pid: process.pid, type: WHMProcessType.TypeScript, name: getScriptName() + " bouncer test", parameters: { a: "a" } });
    await test.wait(() => gotdata, "Expected some data to arrive at conn2");

    conn.send({
      opcode: WHMRequestOpcode.SendEvent,
      eventname: "webhare_testsuite:testevent",
      eventdata: writeMarshalData(testdata)
    });
    for (; ;) {
      const eventresults = await extractResponses(WHMResponseOpcode.IncomingEvent);
      let foundevent;
      for (const event of eventresults)
        if (event.eventname === "webhare_testsuite:testeventbounce") {
          test.eq(testdata, readMarshalData(event.eventdata));
          foundevent = true;
          break;
        }
      if (foundevent)
        break;
    }
    conn2.close();
  }

  // STORY: global ports
  {
    conn.send({
      opcode: WHMRequestOpcode.RegisterPort,
      portname: "webhare_testsuite:porttest",
      linkid: 1,
      msgid: BigInt(2)
    });
    const portresults = await extractResponses(WHMResponseOpcode.RegisterPortResult);
    test.eq([
      {
        opcode: WHMResponseOpcode.RegisterPortResult,
        portname: "webhare_testsuite:porttest",
        linkid: 1,
        replyto: BigInt(2),
        success: true
      }
    ], portresults);

    conn.send({
      opcode: WHMRequestOpcode.ConnectLink,
      portname: "webhare_testsuite:porttest",
      linkid: 2,
      msgid: BigInt(3)
    });
    const openlinkresults = await extractResponses(WHMResponseOpcode.OpenLink);
    test.eq([
      {
        opcode: WHMResponseOpcode.OpenLink,
        portname: "webhare_testsuite:porttest",
        linkid: 0x80000001,
        msgid: BigInt(3)
      }
    ], openlinkresults);
    conn.send({
      opcode: WHMRequestOpcode.OpenLinkResult,
      linkid: 0x80000001,
      replyto: BigInt(3),
      success: true
    });

    const connectresults = await extractResponses(WHMResponseOpcode.ConnectLinkResult);
    test.eq([
      {
        opcode: WHMResponseOpcode.ConnectLinkResult,
        linkid: 2,
        replyto: BigInt(3),
        success: true
      }
    ], connectresults);

    conn.send({
      opcode: WHMRequestOpcode.SendMessageOverLink,
      linkid: 2,
      msgid: BigInt(8),
      replyto: BigInt(7),
      islastpart: true,
      messagedata: writeMarshalPacket(testdata)
    });

    const receiveresults = await extractResponses(WHMResponseOpcode.IncomingMessage);
    test.eq([
      {
        opcode: WHMResponseOpcode.IncomingMessage,
        linkid: 0x80000001,
        msgid: BigInt(8),
        replyto: BigInt(7),
        islastpart: true,
        messagedata: writeMarshalPacket(testdata)
      }
    ], receiveresults);

    conn.send({
      opcode: WHMRequestOpcode.DisconnectLink,
      linkid: 0x80000001
    });

    const disconnectresults = await extractResponses(WHMResponseOpcode.LinkClosed);
    test.eq([
      {
        opcode: WHMResponseOpcode.LinkClosed,
        linkid: 2,
      }
    ], disconnectresults);

    conn.send({
      opcode: WHMRequestOpcode.UnregisterPort,
      portname: "webhare_testsuite:porttest",
      linkid: 7,
      msgid: BigInt(9),
      need_unregister_response: true
    });

    const unregisterresults = await extractResponses(WHMResponseOpcode.UnregisterPortResult);
    test.eq([
      {
        opcode: WHMResponseOpcode.UnregisterPortResult,
        portname: "webhare_testsuite:porttest",
        linkid: 7,
        replyto: BigInt(9)
      }
    ], unregisterresults);
  }

  test.assert(!goterror);
  ref.release();
}

test.runTests([testRPCs]);
