import { litty } from "@webhare/litty";

export function permissionRequestPage({ url, checkScopes, supportedAccessScopes }: {
  url: string;
  checkScopes: Array<keyof typeof supportedAccessScopes>;
  supportedAccessScopes: Record<string, string>;
}) {
  return litty`
        <div class="wh-wrdauth-form">
          <form method="post" action="${url}" enctype="application/x-www-form-urlencoded" class="wh-form wh-form--allowsubmit wh-form--allowprevious">
            <div class="wh-form__page wh-form__page--visible">
              <h2>Permission Request</h2>
              <p>Do you approve the application to access the following on your behalf?</p>
              <ul>
                ${checkScopes.map(scope => litty`<li>${scope} - ${supportedAccessScopes[scope]}</li>`)}
              </ul>
            </div>
            <div class="wh-form__buttongroup wh-form__navbuttons">
              <button class="wh-form__button wh-form__button--previous" name="approve" value="no" type="submit">Deny</button>
              <button class="wh-form__button wh-form__button--submit" name="approve" value="yes" type="submit">Approve</button>
            </div>
          </form>
        </div>
      `;
}
