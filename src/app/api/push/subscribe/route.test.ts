import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({
  saveSubscription: vi.fn<(...args: unknown[]) => Promise<string>>(),
  deleteSubscription: vi.fn<(...args: unknown[]) => Promise<number>>(),
}));
const auth = vi.hoisted(() => ({ userId: "sou" as string | null }));

vi.mock("@/lib/session", () => ({
  getUser: async () => (auth.userId ? { id: auth.userId } : null),
  getMember: async (userId: string) => ({ user_id: userId, role: "learner", first_name: "Sou" }),
}));
vi.mock("@/lib/push", () => push);

const { DELETE, POST } = await import("./route");

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

function request(method: string, body: unknown) {
  return new Request("http://localhost/api/push/subscribe", {
    method,
    headers: { "content-type": "application/json", "user-agent": "test" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  auth.userId = "sou";
  push.saveSubscription.mockReset().mockResolvedValue("saved");
  push.deleteSubscription.mockReset().mockResolvedValue(1);
});

describe("POST /api/push/subscribe", () => {
  it("saves a real push-service subscription for the signed-in member", async () => {
    const response = await POST(request("POST", { endpoint: ENDPOINT, keys }));
    expect(response.status).toBe(200);
    expect(push.saveSubscription).toHaveBeenCalledWith("sou", { endpoint: ENDPOINT, keys }, "test");
  });

  it("refuses endpoints that aren't a browser push service", async () => {
    for (const endpoint of ["https://attacker.example/collect", "http://fcm.googleapis.com/x", "https://169.254.169.254/x"]) {
      const response = await POST(request("POST", { endpoint, keys }));
      expect(response.status, endpoint).toBe(400);
    }
    expect(push.saveSubscription).not.toHaveBeenCalled();
  });

  it("never moves another member's device: 409 instead", async () => {
    push.saveSubscription.mockResolvedValue("owned-by-another-user");
    const response = await POST(request("POST", { endpoint: ENDPOINT, keys }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: "other-account" });
  });

  it("answers 401 when signed out", async () => {
    auth.userId = null;
    expect((await POST(request("POST", { endpoint: ENDPOINT, keys }))).status).toBe(401);
  });
});

describe("DELETE /api/push/subscribe", () => {
  it("only reports a removal when the device was theirs", async () => {
    expect(await (await DELETE(request("DELETE", { endpoint: ENDPOINT }))).json()).toEqual({ ok: true, removed: 1 });
    push.deleteSubscription.mockResolvedValue(0);
    expect(await (await DELETE(request("DELETE", { endpoint: ENDPOINT }))).json()).toEqual({ ok: true, removed: 0 });
    expect(push.deleteSubscription).toHaveBeenCalledWith("sou", ENDPOINT);
  });
});
