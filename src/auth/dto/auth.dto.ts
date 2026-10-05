import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";
import { PublicUser } from "../../users/user.entity.js";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

// Mirrors SignupSchema / LoginSchema in base-frontend (lib/auth/definitions.ts).
export class LoginDto {
  @ApiProperty({ example: "demo@example.com" })
  @Transform(trim)
  @IsEmail({}, { message: "Enter a valid email." })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: "password123" })
  @IsString()
  @IsNotEmpty({ message: "Password is required." })
  @MaxLength(128)
  password!: string;
}

export class RegisterDto {
  @ApiProperty({ example: "Demo User" })
  @Transform(trim)
  @IsString()
  @Length(2, 100, { message: "Name must be at least 2 characters." })
  name!: string;

  @ApiProperty({ example: "new@example.com" })
  @Transform(trim)
  @IsEmail({}, { message: "Enter a valid email." })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: "password123", minLength: 8 })
  // class-validator runs decorators bottom-up; keep the length check last so it's reported first.
  @Matches(/[0-9]/, { message: "Password needs at least one number." })
  @Matches(/[a-zA-Z]/, { message: "Password needs at least one letter." })
  @Length(8, 128, { message: "Password must be 8–128 characters." })
  @IsString()
  password!: string;
}

export class GoogleAuthDto {
  @ApiProperty({ description: "Google ID token (JWT) obtained by the frontend" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  idToken!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refreshToken?: string;
}

export class AuthResponse {
  @ApiProperty({ description: "JWT access token, send as `Authorization: Bearer`" })
  accessToken!: string;

  @ApiProperty({ description: "Opaque refresh token; rotated on every /auth/refresh" })
  refreshToken!: string;

  @ApiProperty({ description: "Access token lifetime in seconds" })
  expiresIn!: number;

  @ApiProperty({ type: PublicUser })
  user!: PublicUser;
}

export class TokenDto {
  @ApiProperty({ description: "One-time token from the emailed link" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: "demo@example.com" })
  @Transform(trim)
  @IsEmail({}, { message: "Enter a valid email." })
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto extends TokenDto {
  @ApiProperty({ example: "newpassword123", minLength: 8 })
  // Same rules as RegisterDto (decorators run bottom-up).
  @Matches(/[0-9]/, { message: "Password needs at least one number." })
  @Matches(/[a-zA-Z]/, { message: "Password needs at least one letter." })
  @Length(8, 128, { message: "Password must be 8–128 characters." })
  @IsString()
  password!: string;
}
