import { createClient } from "@webhare/jsonrpc-client";
import { MyService } from "./type";

const client = createClient<MyService>("webhare_testsuite:testnoauthjs");
export default client;
