import { ApiProperty } from "@nestjs/swagger";
import type { User } from "../generated/prisma/client.js";

/** The `User` shape base-frontend expects. Never includes secrets. */
export class PublicUser {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "email" })
  email!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ description: "Whether the user has confirmed their email address" })
  emailVerified!: boolean;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerifiedAt !== null,
  };
}
