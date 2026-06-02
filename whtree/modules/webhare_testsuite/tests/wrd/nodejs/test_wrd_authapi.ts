import * as whdb from "@webhare/whdb";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { getAuthorizationInterface, getAuthorizationUser, getAuthorizationUsers } from "@webhare/auth";
import type { WRDEntityAuthorization } from "@webhare/auth/src/userrights";
import { CodeContext } from "@webhare/services/src/codecontexts";

async function testAuthObjects() { //test authobjects and the AuthorizationInterface
  const wrdschema = await getWRDSchema();

  await whdb.beginWork();
  const testUnit = await wrdschema.insert("whuserUnit", { wrdTitle: "tempTestUnit" });
  const playerOne = await wrdschema.insert("wrdPerson", {
    wrdFirstName: "Player",
    wrdLastName: "One",
    wrdContactEmail: "player.one@beta.webhare.net",
    whuserUnit: testUnit,
    wrdauthAccountStatus: { status: "active" }
  });
  const playerTwo = await wrdschema.insert("wrdPerson", {
    wrdFirstName: "Player",
    wrdLastName: "Two",
    wrdContactEmail: "player.two@beta.webhare.net",
    whuserUnit: testUnit,
    wrdauthAccountStatus: { status: "active" }
  });
  await whdb.commitWork();

  //blackbox api use to verify the user has no authobject yet
  test.eq(null, await ((getAuthorizationInterface(playerOne) as WRDEntityAuthorization)["getPrimaryAuthObject"](false)));

  //test creating authobjects and their conflict resolution
  const cc1 = new CodeContext("creater 1"); //create authobject in trans 1
  const generatedAuthObject1 = await cc1.run(async () => {
    await whdb.beginWork();
    return await (getAuthorizationInterface(playerOne) as WRDEntityAuthorization)["getPrimaryAuthObject"](true);
  });


  const cc2 = new CodeContext("creater 2"); //this should conflict
  const generatedAuthObject2Promise = cc2.run(async () => {
    await whdb.beginWork();
    return (getAuthorizationInterface(playerOne) as WRDEntityAuthorization)["getPrimaryAuthObject"](true);
  });

  test.eq("Still waiting", await Promise.race([generatedAuthObject2Promise, test.sleep(50).then(() => "Still waiting")]));
  await cc1.run(async () => {
    await whdb.commitWork();
  });

  const generatedAuthObject2 = await generatedAuthObject2Promise; //this waits for cc2 to complete
  test.eq(generatedAuthObject1, generatedAuthObject2, "Both creators should get the same authobject after conflict resolution");

  //Describe the authobjects using their wrdschema
  const playerOneAuth = getAuthorizationInterface(playerOne);
  const playerTwoAuth = getAuthorizationInterface(playerTwo);
  test.eq(playerOne, (await getAuthorizationUsers(wrdschema, [playerOneAuth])).get(playerOneAuth));
  test.eq(undefined, (await getAuthorizationUsers(wrdschema, [playerOneAuth, playerTwoAuth])).get(playerTwoAuth), "Player two hasn't been serialized yet");

  await whdb.runInWork(() => (getAuthorizationInterface(playerTwo) as WRDEntityAuthorization)["getPrimaryAuthObject"](true)); //create authobject for player two

  const playerTwoAuthUncached = getAuthorizationInterface(playerTwo);
  test.eq(playerTwo, (await getAuthorizationUsers(wrdschema, [playerOneAuth, playerTwoAuthUncached])).get(playerTwoAuthUncached));
  test.eq(playerTwo, (await getAuthorizationUser(wrdschema, playerTwoAuthUncached)));
}

test.runTests([
  () => test.resetWTS({
    users: {
      sysop: { grantRights: ["system:sysop"] },
    }
  }),
  testAuthObjects,

]);
