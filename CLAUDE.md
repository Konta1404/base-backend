# base-backend

NestJS 12 (ESM) + Prisma 7 + PostgreSQL API for base-frontend. See README.md for the full picture.

- ESM project: relative imports end in `.js` (`import { X } from "./x.js"`).
- Prisma client is generated into `src/generated/prisma` (git-ignored). Import from
  `../generated/prisma/client.js`, never `@prisma/client`. Run `npm run db:generate` after schema edits.
- Schema changes need a migration: `npm run db:migrate -- --name <change>` (migrates + regenerates); commit
  `prisma/migrations`.
- Routes are private by default (global `JwtAuthGuard`). Mark public routes with `@Public()`;
  read the caller with `@CurrentUser()` and scope every query to that user.
- New env vars go in `src/config/env.ts` (zod) and `.env.example`; read them via `AppConfig.get()`.
- Errors: throw Nest `HttpException`s with user-safe messages; the global filter shapes
  `{ statusCode, message, errors? }`, which base-frontend shows to users verbatim.
- The `/auth/*` request/response shapes are a contract with base-frontend
  (`lib/auth/schemas.ts` there). Don't change them without updating the frontend.
- Cache via `CacheService` (fails open); invalidate keys when the underlying data changes. Background work goes
  through BullMQ queues (see `src/mail/`); never await a Redis-only side effect inside a request.
- Delete users only via `AuthService.deleteAccount` (revokes sessions + cache). Session revocation goes through
  `TokenService.revokeFamily` / `revokeAllForUser`, which also kill live access tokens via Redis.
- Login protection = rate limits (per IP+email, per IP) + `LoginAttemptsService` (failures per account).
  Never key a limit on the email alone: that lets anyone lock a user out.
- Job data sits in Redis in plain text: jobs carrying secrets (links, tokens) must use
  `removeOnComplete/removeOnFail: true` (see `MailService`).
- Log with Nest `Logger` and structured params: `logger.log("msg", { key })`; never log secrets or tokens.
- Checks: `npm run lint && npm run typecheck && npm test && npm run test:e2e` (e2e uses an auto-created `*_test`
  database and Redis db 15 — never the dev data).
