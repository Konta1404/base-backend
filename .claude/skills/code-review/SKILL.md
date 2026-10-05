---
name: code-review
description: Review code changes in this NestJS + Prisma backend for correctness, security (especially auth and data access), and project conventions. Use when asked to review a diff, branch, PR, staged changes, or specific files.
---

# Code review

Review like a careful senior engineer on this project: find real problems, explain why they
matter, suggest a concrete fix. Skip style nits that Prettier/oxlint already enforce.

## 1. Establish scope

- Staged: `git diff --cached` · Working tree: `git diff` + `git status`
- Branch / PR: `git diff main...HEAD` · Specific files: read them in full

Read every changed file in full and follow imports one level out when behaviour depends on them.

## 2. Run the automated checks

```bash
npm run lint && npm run typecheck && npm run format:check && npm test
```

Run `npm run test:e2e` too when a database is available (it truncates tables in `DATABASE_URL`).
Report failures as findings.

## 3. Checklist (in order of severity)

### Auth & authorization

- New routes are protected unless deliberately `@Public()`; justify every `@Public()`.
- Every query on user-owned data is scoped to `@CurrentUser().id` (no IDOR via path/body IDs).
- Tokens, password hashes and secrets never appear in responses, logs or error messages.
  Responses that return users go through `toPublicUser()`.
- Refresh-token changes keep: hashing at rest, single-use rotation, family revocation, grace window.
- Credential endpoints keep `@CredentialRateLimit()`.

### Contract with base-frontend

- `/auth/*` shapes still match `AuthResponse` / `User` (frontend `lib/auth/schemas.ts`):
  `accessToken`, `refreshToken`, `expiresIn` (seconds), `user { id, email, name, avatarUrl }`.
- Status codes the frontend relies on: 401 bad credentials/invalid token, 409 duplicate email.
- Error `message` is a user-safe string.

### Input & data

- Request bodies use DTO classes with class-validator; no `any`/untyped `@Body()`.
- Schema changes come with a committed migration; destructive migrations are called out.
- Multi-step writes that must be consistent use `prisma.$transaction`.
- Unique-constraint races are handled (P2002 → 409), not just pre-checked.

### Correctness & conventions

- Missing `await`, unhandled promise rejections, wrong HTTP codes (`@HttpCode` on non-201 POSTs).
- ESM imports end in `.js`; Prisma types come from `src/generated/prisma/client.js`.
- New env vars are validated in `src/config/env.ts` and documented in `.env.example`.
- Docker: new runtime files are copied into the `runner` stage; no secrets baked into images.

### Tests

- Behaviour changes have unit or e2e coverage; auth changes have e2e coverage.

## 4. Report

Group findings by severity (blocking / should fix / consider), each with file:line, the problem,
why it matters, and a suggested fix. End with a one-line verdict.
