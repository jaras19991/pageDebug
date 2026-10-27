// Developer configuration built into the extension (E4 D5). `npm run build -- --config <file>` (or PDS_CONFIG)
// replaces this file in dist/<target>/lib/ with the given rules; without it the file is copied as is.
// A policy (storage.managed) overrides it at run time — see dev-options.js. Never a setting of the reporter.
export const BUILT_IN_DEV_CONFIG = Object.freeze({ disabledRules: [] });
