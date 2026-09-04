/**
 * Function host entry point.
 *
 * The v4 programming model registers routes as a side effect of import, so
 * every route module must be imported here to be reachable.
 */
import './functions/health.js';
import './functions/auth-routes.js';
import './functions/lot-routes.js';
import './functions/catalog-routes.js';
