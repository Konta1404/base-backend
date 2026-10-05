import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("password123");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    await expect(verifyPassword("password123", hash)).resolves.toBe(true);
    await expect(verifyPassword("password124", hash)).resolves.toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed stored hashes", async () => {
    await expect(verifyPassword("x", "")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt$abc")).resolves.toBe(false);
  });
});
