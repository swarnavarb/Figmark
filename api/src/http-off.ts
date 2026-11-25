/**
 * Turns HTTP registration into a no-op for the clock host.
 *
 * The clocks reach into route modules (the dispute clock lives with its
 * routes), and importing one registers its routes as a side effect. The clock
 * Function App must serve none of them: its address is not behind Static Web
 * Apps, so a route there would skip the auth Static Web Apps puts in front of
 * the API. Imported first by clock-host.ts, before any route module loads.
 */
import { app } from '@azure/functions';

/**
 * The real registration, kept for the one route the clock app does serve on
 * purpose: the AI relay (ai-relay.ts), which checks its own secret instead
 * of relying on Static Web Apps' sign-in.
 */
export const registerHttpAnyway: typeof app.http = app.http.bind(app);

app.http = () => undefined;
