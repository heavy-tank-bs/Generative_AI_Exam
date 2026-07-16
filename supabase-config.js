/*
 * Supabase browser configuration.
 *
 * This file is public when the site is deployed. Set only a Supabase
 * publishable key (sb_publishable_...) here. Never add a secret key or the
 * legacy service_role key.
 */
(function configureSupabase(global) {
  "use strict";

  global.SUPABASE_CONFIG = Object.freeze({
    url: "https://YOUR_PROJECT_REF.supabase.co",
    publishableKey: "sb_publishable_REPLACE_WITH_YOUR_KEY",
    requireSignIn: true,
    syncDebounceMs: 750,
  });
})(window);
