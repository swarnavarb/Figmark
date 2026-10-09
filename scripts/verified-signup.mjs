/**
 * Sign-up for suites that test something other than verification.
 *
 * A new account can browse but not buy or sell until its email, WhatsApp
 * number and Aadhaar are verified. The suites that exercise trading sign
 * people up by the dozen; this wraps the route so each one comes out the far
 * side of those checks, the way a real person would after a few minutes.
 * smoke-verify.mjs is where the checks themselves are tested, end to end.
 */
const dist = new URL('../api/dist/', import.meta.url);
const { getRepository } = await import(new URL('api/src/data/index.js', dist));
const { toAuthUser } = await import(new URL('api/src/auth/mock-provider.js', dist));

export async function markVerified(userId) {
  const repository = await getRepository();
  const user = await repository.getUserById(userId);
  const at = new Date().toISOString();
  user.verification = {
    ...user.verification,
    email: 'verified',
    phone: 'verified',
    governmentId: 'verified',
    proofs: {
      email: { address: user.email, at },
      phone: { number: user.phone, via: 'seed', at },
      aadhaar: { name: user.displayName, dob: '', gender: '', last4: '0000', mobile: user.phone, via: 'seed', at },
    },
  };
  await repository.updateUser(user);
  return user;
}

/** The signup route, with the account verified before the response is read. */
export function verifiedSignup(signupRoute) {
  return async (request, context) => {
    const response = await signupRoute(request, context);
    if (response.status === 201) {
      const user = await markVerified(response.jsonBody.user.id);
      response.jsonBody = { ...response.jsonBody, user: toAuthUser(user) };
    }
    return response;
  };
}
