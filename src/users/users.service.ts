import { Injectable } from "@nestjs/common";
import { CacheService } from "../cache/cache.service.js";
import type { Prisma, User } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { type PublicUser, toPublicUser } from "./user.entity.js";

// Bump the version when PublicUser changes shape, so stale cached entries are ignored.
export const userCacheKey = (id: string) => `user:v2:${id}`;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Public profile, cached in Redis (read on every page via /auth/me).
   * Kept fresh by update() / remove(), which write the new state into the cache.
   */
  getPublicById(id: string): Promise<PublicUser | null> {
    return this.cache.wrap(userCacheKey(id), async () => {
      const user = await this.findById(id);
      return user ? toPublicUser(user) : null;
    });
  }

  /** Drop the cached profile (next read reloads it). Prefer update()/remove(). */
  invalidate(id: string): Promise<void> {
    return this.cache.del(userCacheKey(id));
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  }

  findByGoogleId(googleId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { googleId } });
  }

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data: { ...data, email: normalizeEmail(data.email) } });
  }

  /**
   * Delete a user (refresh tokens and owned rows cascade) and drop the cached
   * profile, so their still-valid access token stops working on /auth/me at once.
   * Always delete users through here, never with prisma.user.delete directly.
   */
  async remove(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
    // Cache "no such user" (not a delete) so an in-flight read can't re-cache the old
    // row; the max version means no late update can resurrect it.
    await this.cache.setVersioned(userCacheKey(id), null, Number.MAX_SAFE_INTEGER);
  }

  /** Throws 404 (via the global filter's P2025 mapping) if the user no longer exists. */
  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    const user = await this.prisma.user.update({ where: { id }, data });
    // Write-through, versioned by updatedAt: see CacheService.wrap / setVersioned for
    // the reader and writer races this avoids.
    await this.cache.setVersioned(userCacheKey(id), toPublicUser(user), user.updatedAt.getTime());
    return user;
  }
}
