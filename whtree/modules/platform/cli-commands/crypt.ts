// @webhare/cli: Direct access to cryptographic primitives

import { run } from "@webhare/cli";
import { decryptForThisServer } from "@webhare/services";

run({
  flags: {
    "v,verbose": "Show more info",
  },
  subCommands: {
    "decrypt-server": {
      description: "Decrypt data encrypted by encryptForThisServer",
      arguments: [
        {
          name: "<scope>",
          description: "The scope of the decryption (e.g 'wrd:oidcauth')",
        }, {
          name: "<data>",
          description: "The encrypted data to decrypt",
        }
      ],
      async main({ opts, args }) {
        console.log(JSON.stringify(await decryptForThisServer(args.scope, args.data), null, 2));

      }
    }
  }
});
