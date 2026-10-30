import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual } from "node:crypto";

type GateSession = { pid?: string | undefined; admin?: boolean };

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

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function requireAdmin() {
  const session = await useSession<GateSession>(sessionConfig());
  if (!session.data.admin) throw new Error("Not allowed");
}

export const getAccess = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<GateSession>(sessionConfig());
  if (!session.data.pid) return { status: "locked" as const };
  const { data } = await (await db())
    .from("access_passwords")
    .select("frozen")
    .eq("id", session.data.pid)
    .maybeSingle();
  if (!data) return { status: "locked" as const };
  return { status: data.frozen ? ("blocked" as const) : ("ok" as const) };
});

export const login = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string }) => ({ password: String(d.password ?? "") }))
  .handler(async ({ data }) => {
    const { data: rows } = await (await db()).from("access_passwords").select("id, password");
    let found: string | undefined;
    for (const p of rows ?? []) if (matches(data.password, p.password)) found = p.id;
    if (!found) return { ok: false as const };
    const session = await useSession<GateSession>(sessionConfig());
    await session.update({ pid: found });
    return { ok: true as const };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<GateSession>(sessionConfig());
  await session.update({ pid: undefined });
  return { ok: true as const };
});

// ---------- Admin ----------
export const adminStatus = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<GateSession>(sessionConfig());
  return { admin: !!session.data.admin };
});

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string }) => ({ password: String(d.password ?? "") }))
  .handler(async ({ data }) => {
    if (!matches(data.password, "irfan@123")) return { ok: false as const };
    const session = await useSession<GateSession>(sessionConfig());
    await session.update({ admin: true });
    return { ok: true as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<GateSession>(sessionConfig());
  await session.update({ admin: false });
  return { ok: true as const };
});

export const listPasswords = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { data, error } = await (await db())
    .from("access_passwords")
    .select("id, password, frozen")
    .order("created_at");
  if (error) throw new Error("Could not load passwords");
  return data;
});

export const addPassword = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string }) => ({ password: String(d.password ?? "").trim() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    if (data.password.length < 3) return { ok: false as const, error: "Too short" };
    const { error } = await (await db()).from("access_passwords").insert({ password: data.password });
    if (error) return { ok: false as const, error: "That password already exists" };
    return { ok: true as const };
  });

export const deletePassword = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => ({ id: String(d.id) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await (await db()).from("access_passwords").delete().eq("id", data.id);
    return { ok: true as const };
  });

export const setFrozen = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; frozen: boolean }) => ({ id: String(d.id), frozen: !!d.frozen }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await (await db()).from("access_passwords").update({ frozen: data.frozen }).eq("id", data.id);
    return { ok: true as const };
  });
