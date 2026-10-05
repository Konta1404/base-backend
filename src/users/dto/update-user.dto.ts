import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, IsUrl, Length, ValidateIf } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class UpdateUserDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100, { message: "Name must be between 2 and 100 characters." })
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: "uri" })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl(
    { protocols: ["https"], require_protocol: true },
    { message: "Avatar must be an https URL." },
  )
  avatarUrl?: string | null;
}
