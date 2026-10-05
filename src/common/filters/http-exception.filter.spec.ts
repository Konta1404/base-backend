import { BadRequestException, ConflictException, Logger, type ArgumentsHost } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client.js";
import { AllExceptionsFilter } from "./http-exception.filter.js";

function run(exception: unknown) {
  const res = {
    status: vi.fn<(code: number) => unknown>().mockReturnThis(),
    json: vi.fn<(body: Record<string, unknown>) => void>(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: "req-1" }) }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status: res.status.mock.calls[0]![0], body: res.json.mock.calls[0]![0] };
}

describe("AllExceptionsFilter", () => {
  it("keeps HttpException messages", () => {
    expect(run(new ConflictException("Email taken."))).toEqual({
      status: 409,
      body: { statusCode: 409, message: "Email taken." },
    });
  });

  it("flattens validation errors to a string message plus an errors list", () => {
    const { body } = run(new BadRequestException(["first", "second"]));
    expect(body).toEqual({ statusCode: 400, message: "first", errors: ["first", "second"] });
  });

  it("maps Prisma unique violations to 409", () => {
    const err = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "test",
    });
    expect(run(err).status).toBe(409);
  });

  it("maps body-parser errors to their 4xx status", () => {
    const tooLarge = Object.assign(new Error("request entity too large"), {
      status: 413,
      type: "entity.too.large",
    });
    expect(run(tooLarge)).toEqual({
      status: 413,
      body: { statusCode: 413, message: "Request body is too large." },
    });
  });

  it("hides internals of unexpected errors", () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    const { status, body } = run(new Error("connection string leaked"));
    expect(status).toBe(500);
    expect(body.message).toBe("Internal server error.");
    expect(body.requestId).toBe("req-1");
  });
});
