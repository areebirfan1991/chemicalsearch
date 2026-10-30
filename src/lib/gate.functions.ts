import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual } from "node:crypto";

type GateSession = { label?: string };

function sessionConfig() {
  return {
    password: process.env["SESSION_SECRET"]!,
    name: "chem-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "none" as const, path: "/" },
  };
}

function matches(input: string, expected: string) {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export const getAccess = createServerFn({ method: "GET" }).handler(async () => {
  const { ACCESS_PASSWORDS } = await import("./access.server");
  const session = await useSession<GateSession>(sessionConfig());
  const entry = ACCESS_PASSWORDS.find((p) => p.label === session.data.label);
  if (!entry) return { status: "locked" as const };
  return { status: entry.blocked ? ("blocked" as const) : ("ok" as const) };
});

export const login = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string }) => ({ password: String(d.password ?? "") }))
  .handler(async ({ data }) => {
    const { ACCESS_PASSWORDS } = await import("./access.server");
    let found: (typeof ACCESS_PASSWORDS)[number] | undefined;
    for (const p of ACCESS_PASSWORDS) if (matches(data.password, p.password)) found = p;
    if (!found) return { ok: false as const };
    const session = await useSession<GateSession>(sessionConfig());
    await session.update({ label: found.label });
    return { ok: true as const };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<GateSession>(sessionConfig());
  await session.clear();
  return { ok: true as const };
});
