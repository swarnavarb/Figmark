/**
 * Entry point for the clock Function App: the timers, the push wake-up
 * queue, and one HTTP route - the AI relay, guarded by its own secret.
 *
 * The same build as the API; the deploy points package.json's main here
 * instead of index.js (see the workflow's clock deploy and docs/AZURE.md).
 */
import './http-off.js';
import './ai-relay.js';
import './clocks.js';
import './push-wake.js';
