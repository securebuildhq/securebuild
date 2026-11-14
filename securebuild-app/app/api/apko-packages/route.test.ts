import { NextRequest } from "next/server";
import { GET } from "./route";
import { getServerSession } from "@/lib/auth/server-session";
import { getAPKOPackages } from "@/lib/image/image";

jest.mock("@/lib/auth/server-session", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/image/image", () => ({ getAPKOPackages: jest.fn() }));

const request = (query = "apkoId=apko-1") =>
  new NextRequest(`http://localhost/api/apko-packages?${query}`);

describe("GET /api/apko-packages", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ id: "session-1" });
  });

  it("requires a session before reading package data", async () => {
    (getServerSession as jest.Mock).mockResolvedValue(undefined);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(getAPKOPackages).not.toHaveBeenCalled();
  });

  it.each(["", "apkoId="])("rejects a missing APKO ID (%s)", async query => {
    const response = await GET(request(query));

    expect(response.status).toBe(400);
    expect(getAPKOPackages).not.toHaveBeenCalled();
  });

  it("returns package dependencies without caching authenticated data", async () => {
    const date = new Date("2026-09-18T12:00:00Z");
    (getAPKOPackages as jest.Mock).mockResolvedValue([
      { id: "package-1", name: "example", createdAt: date, updatedAt: date },
    ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getAPKOPackages).toHaveBeenCalledWith("apko-1");
    expect(await response.json()).toEqual([
      { id: "package-1", name: "example", createdAt: date.toISOString(), updatedAt: date.toISOString() },
    ]);
  });

  it("returns an empty list for an APKO without dependencies", async () => {
    (getAPKOPackages as jest.Mock).mockResolvedValue([]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("handles database failures without exposing internal errors", async () => {
    (getAPKOPackages as jest.Mock).mockRejectedValue(new Error("database details"));
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await GET(request());

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to fetch APKO packages" });
    } finally {
      errorLog.mockRestore();
    }
  });
});
