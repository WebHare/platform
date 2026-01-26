/* Testsuite helpers (not part of @webhare/test-xxx libs as you cannot invoke webhare_testsuite APIs outside of WebHare Platform CI) */
import { invoke } from "@mod-platform/js/testing/whtest";

export type TestSetupData =
  {
    sysopuser: string;
    sysoppassword: string;
    alternatesite: string;
    testportalurl: string;
    overridetoken: string;
    rtdid: number;
    peerserver: string;
    links: {
      rtdpublisher?: string;
      rtdedit?: string;
    };
  };


export async function invokeSetupForTestSetup(options?:
  {
    createsysop?: boolean;
    requirealternatesite?: boolean;
    protectroot?: boolean;
    onpeerserver?: boolean;
    preprtd?: boolean;
  }): Promise<TestSetupData> {

  return await invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupForTestSetup', options);
}
