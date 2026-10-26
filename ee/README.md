# Enterprise Edition

Code in this folder is the Anumat Enterprise Edition. `ee/LICENSE` is its license. Apache 2.0 does not apply here.

`readLicenseKey` turns an untrusted value into a key record, or returns `null` when the value is not a key. `decideUse` allows `development` and `testing` with no key. `production` is allowed only when `agreementSigned` is true and the key is unexpired, has purpose `production`, and lists `feature`. Both functions are in `ee/license-key.ts`.

The feature names reserved for later work are an audit trail, SSO and roles, multi-step review, connectors to outside systems, managed rule feeds, and an on-prem install. Those features are not in this folder yet.

Code in `src/`, `scripts/`, `evals/`, and `test/` must not import this folder. The Apache 2.0 engine runs when this folder is absent from the running program.
