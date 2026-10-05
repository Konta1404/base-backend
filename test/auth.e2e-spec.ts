import { type INestApplication, Logger } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { Test } from "@nestjs/testing";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { AuthService } from "../src/auth/auth.service.js";
import { CacheService } from "../src/cache/cache.service.js";
import { GoogleVerifier, type GoogleIdentity } from "../src/auth/google-verifier.service.js";
import { MAIL_QUEUE } from "../src/mail/mail.constants.js";
import { UsersService } from "../src/users/users.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { REDIS } from "../src/redis/redis.constants.js";
import { configureApp } from "../src/setup.js";

/** Fake Google verifier: the ID token is a JSON-encoded GoogleIdentity. */
const fakeGoogle = {
  enabled: true,
  verify: async (idToken: string): Promise<GoogleIdentity> => JSON.parse(idToken),
};

const idToken = (identity: Partial<GoogleIdentity>) =>
  JSON.stringify({ googleId: "g-123", email: "g@example.com", name: "G User", ...identity });

const tokenFrom = (url: string) => new URL(url).searchParams.get("token")!;

// Shape base-frontend validates (lib/auth/schemas.ts).
const authResponse = expect.objectContaining({
  accessToken: expect.any(String),
  refreshToken: expect.any(String),
  expiresIn: 900,
  user: expect.objectContaining({ id: expect.any(String), email: expect.any(String) }),
});

describe("Auth API (base-frontend contract)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let mailQueue: Queue;
  let http: () => ReturnType<typeof request>;
  let n = 0;
  const email = () => `user${++n}-${Date.now()}@example.com`;

  /** Mail enqueued by the app (captured on Queue#add, since finished jobs are deleted). */
  const sentMail: { name: string; data: Record<string, string> }[] = [];
  const mailJob = async (name: string, to: string) => {
    let data: Record<string, string> | undefined;
    await vi.waitFor(
      () => {
        data = sentMail.find((m) => m.name === name && m.data.email === to)?.data;
        expect(data).toBeDefined();
      },
      { timeout: 5_000 },
    );
    return data!;
  };

  const register = (e = email(), password = "password123") =>
    http().post("/auth/register").send({ name: "Test User", email: e, password }).expect(201);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GoogleVerifier)
      .useValue(fakeGoogle)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    mailQueue = app.get(getQueueToken(MAIL_QUEUE));
    const add = mailQueue.add.bind(mailQueue);
    await mailQueue.obliterate({ force: true }); // leftovers from earlier runs (test Redis db only)
    vi.spyOn(mailQueue, "add").mockImplementation((name, data, opts) => {
      sentMail.push({ name, data });
      return add(name, data, opts);
    });
    http = () => request(app.getHttpServer());
  });

  beforeEach(async () => {
    sentMail.length = 0;
    await prisma.$executeRawUnsafe('TRUNCATE "refresh_tokens", "users" CASCADE');
    // Only this app's keys; never FLUSHDB a Redis you might share.
    for (const pattern of [
      "cache:*",
      "throttle:*",
      "cooldown:*",
      "revoked:*",
      "login-failures:*",
    ]) {
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(...keys);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it("GET /health reports the database and Redis", async () => {
    await http().get("/health").expect(200, { status: "ok", database: "up", redis: "up" });
  });

  describe("register", () => {
    it("creates an account and returns tokens", async () => {
      const res = await register("New.Person@Example.com ");
      expect(res.body).toEqual(authResponse);
      expect(res.body.user).toEqual({
        id: expect.any(String),
        email: "new.person@example.com",
        name: "Test User",
        avatarUrl: null,
        emailVerified: false,
      });
      expect(res.body.user).not.toHaveProperty("passwordHash");
    });

    it("returns 409 for an existing email (case-insensitive)", async () => {
      await register("dup@example.com");
      const res = await http()
        .post("/auth/register")
        .send({ name: "Other", email: "DUP@example.com", password: "password123" })
        .expect(409);
      expect(res.body.message).toMatch(/already exists/);
    });

    it("enqueues a welcome email with a verification link to the frontend", async () => {
      const e = email();
      await register(e);
      const job = await mailJob("welcome", e);
      expect(job.verifyUrl).toMatch(/^http:\/\/localhost:3000\/verify-email\?token=/);
    });

    it("doesn't keep mail jobs (they contain one-time links) in Redis after sending", async () => {
      const e = email();
      await register(e);
      await mailJob("welcome", e);
      await vi.waitFor(async () => {
        const counts = await mailQueue.getJobCounts("waiting", "active", "completed", "failed");
        expect(counts).toEqual({ waiting: 0, active: 0, completed: 0, failed: 0 });
      });
      const keys = await redis.keys("bull:mail:*");
      for (const key of keys) {
        if ((await redis.type(key)) !== "hash") continue;
        expect(await redis.hget(key, "data")).toBeNull();
      }
    });

    it("validates input like the frontend does", async () => {
      const res = await http()
        .post("/auth/register")
        .send({ name: "Ann", email: "ann@example.com", password: "lettersonly" })
        .expect(400);
      expect(res.body.message).toBe("Password needs at least one number.");
    });

    it("rejects unknown fields", async () => {
      await http()
        .post("/auth/register")
        .send({ name: "Ann", email: email(), password: "password123", isAdmin: true })
        .expect(400);
    });
  });

  describe("login", () => {
    it("returns tokens for valid credentials", async () => {
      const e = email();
      await register(e);
      const res = await http().post("/auth/login").send({ email: e, password: "password123" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(authResponse);
    });

    it("returns 401 with the same message for a wrong password or unknown email", async () => {
      const e = email();
      await register(e);
      const wrong = await http().post("/auth/login").send({ email: e, password: "nope" });
      const unknown = await http()
        .post("/auth/login")
        .send({ email: "ghost@example.com", password: "nope" });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it("rate limits repeated attempts per email", async () => {
      const e = email();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        statuses.push((await http().post("/auth/login").send({ email: e, password: "x" })).status);
      }
      expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
      expect(statuses[5]).toBe(429);
      // Another account from the same IP is not affected.
      await http().post("/auth/login").send({ email: email(), password: "x" }).expect(401);
    });

    it("can't be used to lock the real user out from another IP", async () => {
      const e = email();
      await register(e);
      for (let i = 0; i < 6; i++) {
        await http()
          .post("/auth/login")
          .set("X-Forwarded-For", "198.51.100.66")
          .send({ email: e, password: "wrong" });
      }
      await http()
        .post("/auth/login")
        .set("X-Forwarded-For", "198.51.100.66")
        .send({ email: e, password: "wrong" })
        .expect(429); // the attacker's IP is throttled…
      await http()
        .post("/auth/login")
        .set("X-Forwarded-For", "203.0.113.10")
        .send({ email: e, password: "password123" })
        .expect(200); // …the owner is not
    });

    it("pauses an account after many failures from many IPs; reset password lifts it", async () => {
      const e = email();
      await register(e);
      // AUTH_ACCOUNT_FAILURE_LIMIT is 8 in tests; one failure per IP dodges the IP limits.
      for (let i = 0; i < 8; i++) {
        await http()
          .post("/auth/login")
          .set("X-Forwarded-For", `198.51.100.${100 + i}`)
          .send({ email: e, password: "guess" })
          .expect(401);
      }
      const paused = await http()
        .post("/auth/login")
        .set("X-Forwarded-For", "203.0.113.20")
        .send({ email: e, password: "password123" })
        .expect(429);
      expect(paused.body.message).toMatch(/reset your password/);

      await http().post("/auth/forgot-password").send({ email: e }).expect(202);
      const token = tokenFrom((await mailJob("password-reset", e)).url);
      await http().post("/auth/reset-password").send({ token, password: "fresh1234" }).expect(204);
      await http().post("/auth/login").send({ email: e, password: "fresh1234" }).expect(200);
    });

    it("only counts failures: the owner's successful logins reset the count", async () => {
      const e = email();
      await register(e);
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 5; i++) {
          await http()
            .post("/auth/login")
            .set("X-Forwarded-For", `198.51.100.${round * 10 + i}`)
            .send({ email: e, password: "guess" });
        }
        await http()
          .post("/auth/login")
          .set("X-Forwarded-For", "203.0.113.30")
          .send({ email: e, password: "password123" })
          .expect(200);
      }
    });

    it("explains in the logs when a frontend isn't forwarding client IPs", async () => {
      const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
      try {
        // No X-Forwarded-For: every request seems to come from 127.0.0.1 (a private address).
        for (let i = 0; i < 21; i++) {
          await http().post("/auth/login").send({ email: email(), password: "x" });
        }
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("isn't forwarding the browser's IP"),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it("caps attempts per client IP across many emails (credential stuffing)", async () => {
      // oxlint-disable-next-line unicorn/consistent-function-scoping
      const from = (ip: string) =>
        http()
          .post("/auth/login")
          .set("X-Forwarded-For", ip)
          .send({ email: email(), password: "x" });
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) statuses.push((await from("203.0.113.50")).status);
      expect(statuses.slice(0, 20)).toEqual(Array(20).fill(401));
      expect(statuses[20]).toBe(429);
      // Other users (other IPs, as forwarded by base-frontend) are unaffected.
      expect((await from("203.0.113.51")).status).toBe(401);
    });
  });

  describe("me", () => {
    it("returns the user for a valid access token", async () => {
      const { body } = await register();
      const res = await http()
        .get("/auth/me")
        .set("Authorization", `Bearer ${body.accessToken}`)
        .expect(200);
      expect(res.body).toEqual(body.user);
    });

    it("returns 401 without or with a bad token", async () => {
      await http().get("/auth/me").expect(401);
      await http().get("/auth/me").set("Authorization", "Bearer not-a-jwt").expect(401);
    });

    it("returns 401 once the user is deleted", async () => {
      const { body } = await register();
      await prisma.user.delete({ where: { id: body.user.id } });
      await http().get("/auth/me").set("Authorization", `Bearer ${body.accessToken}`).expect(401);
    });

    it("caches the user in Redis and invalidates it on profile update", async () => {
      const { body } = await register();
      const auth = `Bearer ${body.accessToken}`;
      await http().get("/auth/me").set("Authorization", auth).expect(200);
      expect(JSON.parse((await redis.get(`cache:user:v2:${body.user.id}`))!)).toEqual(body.user);

      await http().patch("/users/me").set("Authorization", auth).send({ name: "New Name" });
      const me = await http().get("/auth/me").set("Authorization", auth).expect(200);
      expect(me.body.name).toBe("New Name");
    });
  });

  describe("refresh", () => {
    it("rotates the refresh token", async () => {
      const { body } = await register();
      const res = await http()
        .post("/auth/refresh")
        .send({ refreshToken: body.refreshToken })
        .expect(200);
      expect(res.body).toEqual(authResponse);
      expect(res.body.refreshToken).not.toBe(body.refreshToken);
    });

    it("tolerates a concurrent refresh with the same token (grace window)", async () => {
      const { body } = await register();
      const [a, b] = await Promise.all([
        http().post("/auth/refresh").send({ refreshToken: body.refreshToken }),
        http().post("/auth/refresh").send({ refreshToken: body.refreshToken }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      // Both get the same successor: the session doesn't fork into two live branches.
      expect(a.body.refreshToken).toBe(b.body.refreshToken);
      expect(
        await prisma.refreshToken.count({ where: { userId: body.user.id, revokedAt: null } }),
      ).toBe(1);
      await http().post("/auth/refresh").send({ refreshToken: a.body.refreshToken }).expect(200);
    });

    it("doesn't let a replay within the grace window mint its own session branch", async () => {
      const { body } = await register();
      const legit = await http()
        .post("/auth/refresh")
        .send({ refreshToken: body.refreshToken })
        .expect(200);
      // Attacker replays the old token a moment later: gets the same successor…
      const replay = await http()
        .post("/auth/refresh")
        .send({ refreshToken: body.refreshToken })
        .expect(200);
      expect(replay.body.refreshToken).toBe(legit.body.refreshToken);
      // …so once the legitimate client rotates on, the attacker's copy is spent.
      await http()
        .post("/auth/refresh")
        .send({ refreshToken: legit.body.refreshToken })
        .expect(200);
    });

    it("treats reuse after the grace window as theft and revokes the session", async () => {
      const { body } = await register();
      const first = await http()
        .post("/auth/refresh")
        .send({ refreshToken: body.refreshToken })
        .expect(200);

      // Age the rotation past REFRESH_REUSE_GRACE (2s in tests).
      await prisma.refreshToken.updateMany({
        where: { revokedAt: { not: null } },
        data: { revokedAt: new Date(Date.now() - 60_000) },
      });

      await http().post("/auth/refresh").send({ refreshToken: body.refreshToken }).expect(401);
      // The legitimate successor is revoked too.
      await http()
        .post("/auth/refresh")
        .send({ refreshToken: first.body.refreshToken })
        .expect(401);
    });

    it("revokes the stolen session's access tokens on reuse", async () => {
      const { body } = await register();
      const first = await http()
        .post("/auth/refresh")
        .send({ refreshToken: body.refreshToken })
        .expect(200);
      await prisma.refreshToken.updateMany({
        where: { revokedAt: { not: null } },
        data: { revokedAt: new Date(Date.now() - 60_000) },
      });
      await http().post("/auth/refresh").send({ refreshToken: body.refreshToken }).expect(401);
      await http()
        .get("/auth/me")
        .set("Authorization", `Bearer ${first.body.accessToken}`)
        .expect(401);
    });

    it("returns 401 for an unknown or expired token", async () => {
      await http().post("/auth/refresh").send({ refreshToken: "nope" }).expect(401);

      const { body } = await register();
      await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().post("/auth/refresh").send({ refreshToken: body.refreshToken }).expect(401);
    });
  });

  describe("logout", () => {
    it("revokes the session", async () => {
      const { body } = await register();
      await http()
        .post("/auth/logout")
        .set("Authorization", `Bearer ${body.accessToken}`)
        .send({ refreshToken: body.refreshToken })
        .expect(204);
      await http().post("/auth/refresh").send({ refreshToken: body.refreshToken }).expect(401);
    });

    it("also revokes the session's access token immediately", async () => {
      const { body } = await register();
      const auth = `Bearer ${body.accessToken}`;
      await http().get("/auth/me").set("Authorization", auth).expect(200);
      await http().post("/auth/logout").send({ refreshToken: body.refreshToken }).expect(204);
      await http().get("/auth/me").set("Authorization", auth).expect(401);
    });

    it("leaves the user's other sessions alone", async () => {
      const e = email();
      await register(e);
      const other = await http().post("/auth/login").send({ email: e, password: "password123" });
      const mine = await http().post("/auth/login").send({ email: e, password: "password123" });
      await http().post("/auth/logout").send({ refreshToken: mine.body.refreshToken }).expect(204);
      await http()
        .get("/auth/me")
        .set("Authorization", `Bearer ${other.body.accessToken}`)
        .expect(200);
    });

    it("accepts a missing refresh token", async () => {
      await http().post("/auth/logout").send({}).expect(204);
    });
  });

  describe("google", () => {
    it("creates a user on first sign-in and reuses it after", async () => {
      const first = await http()
        .post("/auth/google")
        .send({ idToken: idToken({ picture: "https://example.com/a.png" }) })
        .expect(200);
      expect(first.body).toEqual(authResponse);
      expect(first.body.user.avatarUrl).toBe("https://example.com/a.png");

      const second = await http()
        .post("/auth/google")
        .send({ idToken: idToken({}) })
        .expect(200);
      expect(second.body.user.id).toBe(first.body.user.id);
    });

    it("links Google to a verified password account and keeps the password", async () => {
      const { body } = await register("g@example.com");
      await prisma.user.update({
        where: { id: body.user.id },
        data: { emailVerifiedAt: new Date() },
      });
      const res = await http()
        .post("/auth/google")
        .send({ idToken: idToken({}) })
        .expect(200);
      expect(res.body.user.id).toBe(body.user.id);
      await http()
        .post("/auth/login")
        .send({ email: "g@example.com", password: "password123" })
        .expect(200);
      // Existing sessions are untouched.
      await http().post("/auth/refresh").send({ refreshToken: body.refreshToken }).expect(200);
    });

    it("blocks pre-account takeover: an unverified squatter loses the account", async () => {
      // Attacker registers the victim's address with their own password, never verifies.
      const squatter = await register("g@example.com", "attacker123");
      const pendingLink = tokenFrom((await mailJob("welcome", "g@example.com")).verifyUrl!);

      // The real owner signs in with Google.
      const owner = await http()
        .post("/auth/google")
        .send({ idToken: idToken({ name: "Real Owner" }) })
        .expect(200);
      expect(owner.body.user).toMatchObject({
        id: squatter.body.user.id,
        name: "Real Owner",
        emailVerified: true,
      });

      // The attacker's password, sessions and access token are all dead…
      await http()
        .post("/auth/login")
        .send({ email: "g@example.com", password: "attacker123" })
        .expect(401);
      await http()
        .post("/auth/refresh")
        .send({ refreshToken: squatter.body.refreshToken })
        .expect(401);
      await http()
        .get("/auth/me")
        .set("Authorization", `Bearer ${squatter.body.accessToken}`)
        .expect(401);
      // …and so are links issued before the takeover.
      await http().post("/auth/verify-email").send({ token: pendingLink }).expect(400);

      // The owner keeps working.
      await http()
        .get("/auth/me")
        .set("Authorization", `Bearer ${owner.body.accessToken}`)
        .expect(200);
    });

    it("does not allow password login for Google-only accounts", async () => {
      await http()
        .post("/auth/google")
        .send({ idToken: idToken({}) })
        .expect(200);
      await http().post("/auth/login").send({ email: "g@example.com", password: "" }).expect(400);
      await http()
        .post("/auth/login")
        .send({ email: "g@example.com", password: "password123" })
        .expect(401);
    });
  });

  describe("users", () => {
    it("PATCH /users/me updates the profile", async () => {
      const { body } = await register();
      const res = await http()
        .patch("/users/me")
        .set("Authorization", `Bearer ${body.accessToken}`)
        .send({ name: "  Renamed  ", avatarUrl: "https://example.com/me.png" })
        .expect(200);
      expect(res.body).toMatchObject({ name: "Renamed", avatarUrl: "https://example.com/me.png" });
    });

    it("requires authentication", async () => {
      await http().patch("/users/me").send({ name: "Nope" }).expect(401);
    });
  });

  describe("email verification", () => {
    it("verifies with the emailed link, once", async () => {
      const e = email();
      const { body } = await register(e);
      const token = tokenFrom((await mailJob("welcome", e)).verifyUrl!);

      await http().post("/auth/verify-email").send({ token }).expect(204);
      const me = await http()
        .get("/auth/me")
        .set("Authorization", `Bearer ${body.accessToken}`)
        .expect(200);
      expect(me.body.emailVerified).toBe(true);

      const again = await http().post("/auth/verify-email").send({ token }).expect(400);
      expect(again.body.message).toBe("This link is invalid or has expired.");
    });

    it("rejects expired links", async () => {
      const e = email();
      await register(e);
      const token = tokenFrom((await mailJob("welcome", e)).verifyUrl!);
      await prisma.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().post("/auth/verify-email").send({ token }).expect(400);
    });

    it("resends a new link (and invalidates the old one), at most once a minute", async () => {
      const e = email();
      const { body } = await register(e);
      const oldToken = tokenFrom((await mailJob("welcome", e)).verifyUrl!);
      const auth = `Bearer ${body.accessToken}`;

      await http().post("/auth/verify-email/resend").set("Authorization", auth).expect(202);
      const fresh = tokenFrom((await mailJob("verify-email", e)).url);
      await http().post("/auth/verify-email/resend").set("Authorization", auth).expect(202);
      expect(await prisma.authToken.count({ where: { userId: body.user.id } })).toBe(1);

      await http().post("/auth/verify-email").send({ token: oldToken }).expect(400);
      await http().post("/auth/verify-email").send({ token: fresh }).expect(204);
    });

    it("marks Google accounts as verified", async () => {
      const res = await http()
        .post("/auth/google")
        .send({ idToken: idToken({}) })
        .expect(200);
      expect(res.body.user.emailVerified).toBe(true);
    });
  });

  describe("password reset", () => {
    it("answers 202 for unknown emails without sending anything", async () => {
      await http().post("/auth/forgot-password").send({ email: "nobody@example.com" }).expect(202);
      await new Promise((r) => setTimeout(r, 300)); // background work
      expect(await prisma.authToken.count()).toBe(0);
      expect(sentMail.some((m) => m.name === "password-reset")).toBe(false);
    });

    it("responds before looking the email up, so timing can't reveal accounts", async () => {
      const e = email();
      await register(e);
      // Make the account lookup very slow: if it were on the response path, we'd wait for it.
      const users = app.get(UsersService);
      const original = users.findByEmail.bind(users);
      const slow = vi.spyOn(users, "findByEmail").mockImplementation(async (address) => {
        await new Promise((r) => setTimeout(r, 1_500));
        return original(address);
      });
      try {
        const start = performance.now();
        await http().post("/auth/forgot-password").send({ email: e }).expect(202);
        expect(performance.now() - start).toBeLessThan(1_000);
        await mailJob("password-reset", e); // the work still happens, after the response
      } finally {
        slow.mockRestore();
      }
    });

    it("resets the password with the emailed link and signs out every session", async () => {
      const e = email();
      const { body } = await register(e);
      await http().post("/auth/forgot-password").send({ email: e.toUpperCase() }).expect(202);
      const token = tokenFrom((await mailJob("password-reset", e)).url);

      const weak = await http()
        .post("/auth/reset-password")
        .send({ token, password: "short" })
        .expect(400);
      expect(weak.body.message).toBe("Password must be 8–128 characters.");

      await http()
        .post("/auth/reset-password")
        .send({ token, password: "brandnew123" })
        .expect(204);

      // Old sessions are gone: refresh token and access token.
      await http().post("/auth/refresh").send({ refreshToken: body.refreshToken }).expect(401);
      await http().get("/auth/me").set("Authorization", `Bearer ${body.accessToken}`).expect(401);

      await http().post("/auth/login").send({ email: e, password: "password123" }).expect(401);
      const login = await http()
        .post("/auth/login")
        .send({ email: e, password: "brandnew123" })
        .expect(200);
      expect(login.body.user.emailVerified).toBe(true);

      await http().post("/auth/reset-password").send({ token, password: "another123" }).expect(400);
    });
  });

  describe("profile cache", () => {
    it("keeps the newest profile when concurrent updates reach the cache out of order", async () => {
      const cache = app.get(CacheService);
      await cache.setVersioned("race", { name: "second" }, 2_000);
      await cache.setVersioned("race", { name: "first" }, 1_000); // older write lands last
      expect(await cache.get("race")).toEqual({ name: "second" });
      await cache.del("race");
    });
  });

  describe("account deletion", () => {
    it("invalidates the user's access tokens and cached profile at once", async () => {
      const { body } = await register();
      const auth = `Bearer ${body.accessToken}`;
      await http().get("/auth/me").set("Authorization", auth).expect(200); // now cached
      await app.get(AuthService).deleteAccount(body.user.id);
      await http().get("/auth/me").set("Authorization", auth).expect(401);
      expect(await redis.get(`cache:user:v2:${body.user.id}`)).toBe("null");
    });
  });

  describe("HTTP plumbing", () => {
    it("returns 413 for oversized bodies", async () => {
      const res = await http()
        .post("/auth/login")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ email: "a".repeat(200_000), password: "x" }))
        .expect(413);
      expect(res.body.message).toBe("Request body is too large.");
    });

    it("adds a request id, reusing a valid incoming one", async () => {
      const generated = await http().get("/health/live");
      expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
      const echoed = await http().get("/health/live").set("X-Request-Id", "trace-123");
      expect(echoed.headers["x-request-id"]).toBe("trace-123");
    });

    it("serves Prometheus metrics behind METRICS_TOKEN", async () => {
      await http().get("/metrics").expect(401);
      const res = await http()
        .get("/metrics")
        .set("Authorization", "Bearer e2e-metrics-token-e2e")
        .expect(200);
      expect(res.text).toContain("http_request_duration_seconds_bucket");
      expect(res.text).toContain("process_cpu_user_seconds_total");
    });
  });
});
