/**
 * Function host entry point.
 *
 * The v4 programming model registers routes as a side effect of import, so
 * every route module must be imported here to be reachable.
 */
import './functions/health.js';
import './functions/auth-routes.js';
import './functions/catalog-routes.js';
import './functions/fulfilment-routes.js';
import './functions/seller-routes.js';
import './functions/social-routes.js';
import './functions/message-routes.js';
import './functions/order-routes.js';
import './functions/dispute-routes.js';
import './functions/profile-routes.js';
import './functions/want-routes.js';
import './functions/admin-routes.js';
