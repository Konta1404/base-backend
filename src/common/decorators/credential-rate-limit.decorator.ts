import { SetMetadata } from "@nestjs/common";

export const CREDENTIAL_RATE_LIMIT_KEY = "credentialRateLimit";

/**
 * For routes that take a password or an email (login, register, forgot-password):
 * - AUTH_THROTTLE_LIMIT per client IP + submitted email (targeted guessing), and
 * - AUTH_IP_THROTTLE_LIMIT per client IP, across all emails (credential stuffing).
 * Per-account guessing from many IPs: see LoginAttemptsService.
 * See src/common/throttle.ts.
 */
export const CredentialRateLimit = () => SetMetadata(CREDENTIAL_RATE_LIMIT_KEY, true);
