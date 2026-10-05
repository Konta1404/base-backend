import { Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { OAuth2Client } from "google-auth-library";
import { AppConfig } from "../config/app-config.service.js";

export interface GoogleIdentity {
  googleId: string;
  email: string;
  name?: string;
  picture?: string;
}

/** Verifies Google ID tokens: signature (Google's JWKS), `aud`, `iss`, `exp`, and verified email. */
@Injectable()
export class GoogleVerifier {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: AppConfig) {}

  get enabled() {
    return this.config.get("GOOGLE_CLIENT_ID").length > 0;
  }

  async verify(idToken: string): Promise<GoogleIdentity> {
    if (!this.enabled) throw new ServiceUnavailableException("Google sign-in is not configured.");

    let payload;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.config.get("GOOGLE_CLIENT_ID"),
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException("Invalid Google token.");
    }

    if (!payload?.sub || !payload.email) throw new UnauthorizedException("Invalid Google token.");
    if (!payload.email_verified) throw new UnauthorizedException("Google email is not verified.");

    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  }
}
