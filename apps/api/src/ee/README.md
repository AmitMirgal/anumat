# Enterprise Edition

This directory holds the enterprise license note and the license-key check for the API. It has no other enterprise features yet.

Enterprise code plugs in through `createApp({ plugins })` and the interfaces in `packages/core/src/plugins.ts`.

Free code never imports from any `ee/` directory. Enterprise code may import free code.

`readLicenseKey` turns an untrusted value into a key record, or returns `null` when the value is not a key. `decideUse` allows `development` and `testing` with no key. `production` is allowed only when `agreementSigned` is true and the key is unexpired, has purpose `production`, and lists `feature`. Both functions are in `license-key.ts`.

The license for this directory is `LICENSE-EE.md` at the repository root. Apache 2.0 does not apply here.
