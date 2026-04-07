import { getTid } from "@webhare/gettid";
import type { ContentPageRequest, WebResponse } from "@webhare/router";
import { litty } from "@webhare/litty";
import { db } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";

export async function renderJSPage(request: ContentPageRequest): Promise<WebResponse> {
  return await request.buildWebPage(litty`<p id="gettidtest">${getTid("webhare_testsuite:test.testencoding")}</p>`);
}

export async function renderDynamicPage(request: ContentPageRequest): Promise<WebResponse> {
  if (!request.webRequest)
    throw new Error(`renderDynamicPage didn't see a webRequest object`);

  const url = new URL(request.webRequest.url);
  return await request.buildWebPage(litty`<p>renderDynamicPage(echo = ${url.searchParams.get("echo") || ''})</p>`);
}

export async function renderAuthTestPage(request: ContentPageRequest): Promise<WebResponse> {
  await request.initializePlugins();
  const authPlugin = request.getPlugin("platform:wrdauth");
  if (!authPlugin)
    throw new Error(`renderAuthTestPage didn't see a wrdauth plugin`);


  const isLoggedIn = await authPlugin.isLoggedIn() || false;
  const allClaims = await authPlugin.getClaims();
  const userId = await authPlugin.getUser();
  const numSessions = userId ? (await db<PlatformDB>().selectFrom("wrd.tokens").selectAll().where("entity", "=", userId).execute()).length : 0;
  const multisite = request.targetObject.name.includes("multisite");


  return request.buildWebPage(litty`<h1>wrd.auth tests</h1>
  [pwdresetresult]
  <div class="wrdauthtest">
    <fieldset>
      <legend>WRD Auth witty status</legend>
      isloggedin: <input disabled id="isloggedin" type="checkbox" ${isLoggedIn ? "checked" : ""}>
        userid: <span id="userid">${userId || ""}</span>
        loginname: <span id="loginname">${await authPlugin.getLogin() || ""}</span>
      <br>
      logoutlink: <input readonly id="logoutlink" value="${authPlugin.getLogoutLink() || ""}" style="width:300px" autocomplete="off"><button id="logout" type="button">Logout</button><br/>
      allclaims: <input readonly id="allclaims" value="${JSON.stringify(allClaims)}"><br>
      numsessions: <input readonly id="numsessions" value="${numSessions}">
    </fieldset>

    <fieldset>
      <legend>WRD Auth JavaScript status</legend>
      isloggedin: <input disabled id="js_isloggedin" type="checkbox" autocomplete="off"><br>
      fullname: <input readonly id="js_fullname" data-wrdauth-value="wrd_fullname" autocomplete="off"/><br>
      <button class="wh-wrdauth__logout" type="button">JS Logout</button><br/>
    </fieldset>

    <fieldset>
      <legend>Login form</legend>
      <div style="display:flex;">
        <div style="flex:1">
          <h2>Global login</h2>
            <form id="loginform" class="wh-wrdauth__loginform" autocomplete="off" method="POST">
              <input name="login" id="login" placeholder="login"><br>
              <input name="password" id="password" placeholder="password" type="password"><br>
              Redirect to:
                <label><input id="returnto_here" name="returnto" type="radio" value="" checked/>here</label>
                <label><input id="returnto_postlogin" name="returnto" type="radio" value="?postlogin" />?postlogin</label>
                <label><input id="returnto_staticpage" name="returnto" type="radio" value="[siteroot]TestPages/staticpage-en-gb" />TestPages/staticpage-en-gb</label>
                <br>
              <input type="submit" id="loginbutton" value="Login">
            </form>
            <div id="loginform_response"></div>
          </div>
          ${multisite ? litty`
            <div style="flex:1">
              <h2 style="break-before:column">Site login</h2>
              <form id="multisite_loginform" class="wh-wrdauth__loginform" autocomplete="off" method="POST">
                <input name="login" id="multisite_login" placeholder="login"><br>
                <input name="password" id="multisite_password" placeholder="password" type="password"><br>
                <select name="site" id="multisite_site">
                  <option value="1">Site 1</option>
                  <option value="2">Site 2</option>
                </select>
                <input type="submit" id="multisite_loginbutton" value="Login">
              </form>
            </div>` : ""}
          <div style="flex:1">
            <button type="button" id="customclaimbutton">Custom claim login</button><br>
            <button type="button" id="ssobutton">SSO button</button><br>
            <button type="button" id="ssopassivebutton">SSO passive button</button>
            <span id="ssopassivestatus"></span><br>
          </div>
        </div>
    </fieldset>

    <fieldset>
      <legend>Password reset form</legend>
      <form id="passwordresetform" method="post" action="[feedbackurl]" autocomplete="off">
        <input name="resetlogin" id="resetlogin" placeholder="login"><br>
        <input type="submit" name="passwordresetbutton" id="passwordresetbutton" value="Password rset">
      </form>
    </fieldset>

    <fieldset>
      <legend>User details form</legend>
      <form id="detailsform" method="post" action="[feedbackurl]" autocomplete="off">
        <input name="firstname" id="firstname" placeholder="first name" value="[firstname]"><br>
        <input name="lastname"  id="lastname"  placeholder="last name"  value="[lastname]"><br>
        <input name="detailsbutton" type="submit" id="detailsbutton" value="Update details">
      </form>
    </fieldset>

    <div id="status">statusdiv</div>
    <a id="static" href="../wrdauthtest-static/">static</a>
  </div>`);
}
