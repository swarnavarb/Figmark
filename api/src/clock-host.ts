/**
 * Entry point for the clock Function App: the timers and the push wake-up
 * queue, and no HTTP at all.
 *
 * The same build as the API; the deploy points package.json's main here
 * instead of index.js (see the workflow's clock deploy and docs/AZURE.md).
 */
import './http-off.js';
import './clocks.js';
import './push-wake.js';
