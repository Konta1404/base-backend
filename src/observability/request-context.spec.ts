import { maskIp } from "./request-context.js";

describe("maskIp", () => {
  it("drops the last IPv4 octet", () => {
    expect(maskIp("203.0.113.42")).toBe("203.0.113.0");
    expect(maskIp("::ffff:203.0.113.42")).toBe("203.0.113.0");
  });
  it("keeps the first 48 bits of IPv6", () => {
    expect(maskIp("2001:db8:abcd:12:34::1")).toBe("2001:db8:abcd::");
    expect(maskIp("2001:db8::1")).toBe("2001:db8::");
  });
  it("passes undefined through", () => {
    expect(maskIp(undefined)).toBeUndefined();
  });
});
