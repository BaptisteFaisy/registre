# Local type declarations for the AWS SDK v3

`tsc --noEmit` spent ~3 min 40 s of its 5 min 47 s run loading the real
`@aws-sdk/*` type declarations (~700 files). That broke the CI budget rule
("a job must give its verdict in under 5 minutes"), so `tsconfig.json` maps the
SDK module names to the small declarations in this folder via `paths`.

* The **real packages are still what runs** in production: `paths` only affects
  the type checker, and the adapters import the SDK lazily at runtime.
* Each file declares exactly the surface this repository uses — clients,
  commands, and the response fields the code reads — with an index signature so
  anything else still compiles.
* To get the full SDK types back in an editor, remove the `paths` entries from
  `tsconfig.json` (and accept a multi-minute typecheck).
