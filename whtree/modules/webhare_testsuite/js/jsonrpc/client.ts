import { createClient } from "@webhare/jsonrpc-client";
import type { MyService } from "./type";

const client = createClient<MyService>("webhare_testsuite:testnoauthjs");
export default client;
