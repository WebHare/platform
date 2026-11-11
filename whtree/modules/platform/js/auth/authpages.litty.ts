import { litty } from "@webhare/litty";

export function permissionRequestPage({ url, checkScopes, supportedAccessScopes, mcpServerHost, returnHost, unverifiedClient }: {
  url: string;
  checkScopes: Array<keyof typeof supportedAccessScopes>;
  supportedAccessScopes: Record<string, string>;
  /** Host of the MCP server the application requests access to, null if it doesn't */
  mcpServerHost: string | null;
  /** Host the user returns to after approving or denying, which identifies the application */
  returnHost: string;
  /** Set if the application registered itself (dynamic client registration), so we can't verify who it is */
  unverifiedClient: boolean;
}) {
  return litty`
        <div class="wh-wrdauth-form">
          <form method="post" action="${url}" enctype="application/x-www-form-urlencoded" class="wh-form wh-form--allowsubmit wh-form--allowprevious">
            <div class="wh-form__page wh-form__page--visible">
              <h2>Permission Request</h2>
              ${mcpServerHost ? litty`
                <p>An AI assistant or other application at <strong>${returnHost}</strong> wants to connect to <strong>${mcpServerHost}</strong> as you.</p>
                <p>If you approve, it can use the tools this website offers to AI assistants, with your access rights - for example reading or changing data you have access to.</p>`
                : litty`<p>An application at <strong>${returnHost}</strong> is asking for access on your behalf.</p>`}
              ${unverifiedClient ? litty`<p class="wh-wrdauth-form__warning">This application registered itself, so its identity can't be verified. Only approve this if you're connecting it yourself right now.</p>` : ""}
              ${checkScopes.length ? litty`
                <p>Do you approve the application to access the following on your behalf?</p>
                <ul>
                  ${checkScopes.map(scope => litty`<li>${scope} - ${supportedAccessScopes[scope]}</li>`)}
                </ul>` : ""}
            </div>
            <div class="wh-form__buttongroup wh-form__navbuttons">
              <button class="wh-form__button wh-form__button--previous" name="approve" value="no" type="submit">Deny</button>
              <button class="wh-form__button wh-form__button--submit" name="approve" value="yes" type="submit">Approve</button>
            </div>
          </form>
        </div>
      `;
}
