import createRPCClient from "@webhare/jsonrpc-client";
import { MyService } from "./type";

const client = createRPCClient<MyService>("webhare_testsuite:testnoauthjs");
export default client;
