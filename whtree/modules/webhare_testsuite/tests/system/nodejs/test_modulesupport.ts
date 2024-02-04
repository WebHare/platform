import { ApplicabilityRestrictions, getApplicabilityError, getMyApplicabilityInfo } from "@mod-system/js/internal/generation/shared";
import * as test from "@webhare/test";

function isApplicable(restr: ApplicabilityRestrictions) {
  return !getApplicabilityError(getMyApplicabilityInfo(), restr);
}

function testApplicability() {
  const platform = process.env.WEBHARE_PLATFORM;
  test.assert(platform, `Cannot run this test if WEBHARE_PLATFORM is unset`);

  const basesettings: ApplicabilityRestrictions = {
    webhareversion: "",
    minservertype: "",
    maxservertype: "",
    restrictservers: [""],
    ifenvironset: [],
    unlessenvironset: [],
    ifmodules: ""
  };

  test.assert(isApplicable(basesettings), `Empty settings should always be applicable`);

  test.eq(true, isApplicable({ ...basesettings, ifmodules: "system; publisher" }));
  test.eq(false, isApplicable({ ...basesettings, ifmodules: "system; neversuchmodule" }));
  test.eq(true, isApplicable({ ...basesettings, ifmodules: "system;;;" }));
  test.eq(false, isApplicable({ ...basesettings, ifmodules: "System" }));

  test.eq(true, isApplicable({ ...basesettings, ifenvironset: ["WEBHARE_PLATFORM"] }));
  test.eq(false, isApplicable({ ...basesettings, unlessenvironset: ["WEBHARE_PLATFORM"] }));
  test.eq(false, isApplicable({ ...basesettings, ifenvironset: ["WEBHARE_PLATFORM=dummy"] }));
  test.eq(true, isApplicable({ ...basesettings, ifenvironset: [`WEBHARE_PLATFORM=${platform}`, "WEBHARE_PLATFORM"] }));
  test.eq(true, isApplicable({ ...basesettings, unlessenvironset: ["WEBHARE_PLATFORM=dummy", "OTHERENV"] }));
  test.eq(false, isApplicable({ ...basesettings, unlessenvironset: [`WEBHARE_PLATFORM=${platform}`] }));
  test.eq(false, isApplicable({ ...basesettings, unlessenvironset: ["WEBHARE_PLATFORM=dummy", "WEBHARE_PLATFORM"] }));
}

test.run([testApplicability]);
