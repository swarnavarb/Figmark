import type { HttpRequest } from '@azure/functions';
import type { AuthMode, AuthUser, LoginRequest, LoginResponse } from '../../../shared/contracts.js';
import type { UserRole } from '../../../shared/enums.js';
import { USER_ROLES } from '../../../shared/enums.js';
import type { Repository } from '../data/repository.js';
import { AuthError } from './errors.js';
import { toAuthUser } from './mock-provider.js';
import type { AuthService } from './types.js';

/**
 * The real-auth swap-in target.
 *
 * Static Web Apps terminates the identity provider (Entra External ID, GitHub,
 * or a custom OIDC provider configured in staticwebapp.config.json) and injects
 * the resulting principal as the `x-ms-client-principal` header. This provider
 * reads that header and resolves it to the application's own user record.
 *
 * It is complete enough to switch on with `AUTH_MODE=swa` once a provider is
 * configured and users have been provisioned. Sign-in and sign-out are handled
 * by the platform at `/.auth/login/<provider>` and `/.auth/logout`, so the
 * credential endpoints intentionally refuse.
 */
export class StaticWebAppsAuthProvider implements AuthService {
  readonly mode: AuthMode = 'swa';

  constructor(private readonly repository: Repository) {}

  async getCurrentUser(request: HttpRequest): Promise<AuthUser | null> {
    const principal = readClientPrincipal(request);
    if (!principal?.userId) return null;

    // The platform's user id is the link between the external identity and our
    // own user document; it is stored as the document id at provisioning time.
    const user = await this.repository.getUserById(principal.userId);
    if (!user || user.suspended) return null;

    // Platform roles are authoritative when present, so access can be revoked
    // in the identity provider without a write to our store.
    const platformRole = principal.userRoles?.find((role): role is UserRole =>
      (USER_ROLES as readonly string[]).includes(role),
    );

    return { ...toAuthUser(user), role: platformRole ?? user.role };
  }

  async requireAuth(request: HttpRequest): Promise<AuthUser> {
    const user = await this.getCurrentUser(request);
    if (!user) throw AuthError.unauthenticated();
    return user;
  }

  async requireRole(request: HttpRequest, roles: readonly UserRole[]): Promise<AuthUser> {
    const user = await this.requireAuth(request);
    if (!roles.includes(user.role)) {
      throw AuthError.forbidden(
        `This action requires one of: ${roles.join(', ')}. Your role is ${user.role}.`,
      );
    }
    return user;
  }

  async login(_credentials: LoginRequest): Promise<LoginResponse> {
    throw AuthError.notImplemented(
      'Sign-in is handled by the identity provider. Redirect the browser to /.auth/login/<provider>.',
    );
  }

  async logout(_request: HttpRequest): Promise<void> {
    // The platform clears its own session at /.auth/logout; nothing to do here.
  }

  listDemoAccounts(): Array<{ username: string; role: UserRole }> {
    return [];
  }

  loginCookies(): string[] {
    return [];
  }

  logoutCookies(): string[] {
    return [];
  }
}

interface ClientPrincipal {
  identityProvider?: string;
  userId?: string;
  userDetails?: string;
  userRoles?: string[];
}

function readClientPrincipal(request: HttpRequest): ClientPrincipal | null {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as ClientPrincipal;
  } catch {
    return null;
  }
}
