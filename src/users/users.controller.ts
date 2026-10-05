import { Body, Controller, Patch } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type AuthUser } from "../common/decorators/current-user.decorator.js";
import { UpdateUserDto } from "./dto/update-user.dto.js";
import { PublicUser, toPublicUser } from "./user.entity.js";
import { UsersService } from "./users.service.js";

/**
 * Example of a protected resource. From base-frontend:
 *   server:  await api<User>("/users/me", { method: "PATCH", json: { name } })
 *   client:  fetch("/api/backend/users/me", { method: "PATCH", ... })
 */
@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch("me")
  @ApiOkResponse({ type: PublicUser })
  async updateMe(@CurrentUser() auth: AuthUser, @Body() dto: UpdateUserDto): Promise<PublicUser> {
    return toPublicUser(await this.users.update(auth.id, dto));
  }
}
