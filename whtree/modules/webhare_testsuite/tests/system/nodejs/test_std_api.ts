import * as test from "@webhare/test";
import testlist from "./test_std_tests";

//test.run doesn't understand labels, sofilter those
test.run(testlist.filter(_ => typeof _ !== 'string') as Array<() => Promise<void>>);
