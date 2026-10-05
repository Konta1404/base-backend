/**
 * Development seed. Creates the demo account base-frontend's README advertises:
 *   demo@example.com / password123
 * Idempotent; refuses to run in production.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/auth/password.js";
import { PrismaClient } from "../src/generated/prisma/client.js";

if (process.env.NODE_ENV === "production") {
  console.log("Skipping seed in production.");
  process.exit(0);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const email = "demo@example.com";
const existing = await prisma.user.findUnique({ where: { email } });
if (!existing) {
  await prisma.user.create({
    data: {
      email,
      name: "Demo User",
      passwordHash: await hashPassword("password123"),
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`Seeded ${email} / password123`);
} else {
  console.log(`Seed: ${email} already exists`);
}
await prisma.$disconnect();
