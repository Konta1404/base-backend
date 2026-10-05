import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Opt a route (or controller) out of the global JWT guard. Routes are private by default. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
