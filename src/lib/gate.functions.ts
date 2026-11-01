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
  if (session.data.admin) return { status: "ok" as const };
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
    if (matches(data.password, "irfan@123")) {
      const s = await useSession<GateSession>(sessionConfig());
      await s.update({ admin: true });
      return { ok: true as const, admin: true };
    }
    const { data: rows } = await (await db()).from("access_passwords").select("id, password");
    let found: string | undefined;
    for (const p of rows ?? []) if (matches(data.password, p.password)) found = p.id;
    if (!found) return { ok: false as const };
    const session = await useSession<GateSession>(sessionConfig());
    await session.update({ pid: found });
    return { ok: true as const, admin: false };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<GateSession>(sessionConfig());
  await session.clear();
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
    .select("id, password, frozen, preload_name")
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

// ---------- Preloaded file per password ----------
export const preloadUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; name: string }) => ({ id: String(d.id), name: String(d.name).slice(0, 200) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const path = `${data.id}/${Date.now()}-${data.name.replace(/[^\w.\- ]/g, "_")}`;
    const { data: signed, error } = await (await db()).storage.from("preloads").createSignedUploadUrl(path);
    if (error || !signed) throw new Error("Could not prepare upload");
    return { path, token: signed.token };
  });

export const setPreload = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; path: string | null; name: string | null }) => ({
    id: String(d.id), path: d.path ? String(d.path) : null, name: d.name ? String(d.name) : null,
  }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const admin = await db();
    const { data: old } = await admin.from("access_passwords").select("preload_path").eq("id", data.id).maybeSingle();
    if (old?.preload_path && old.preload_path !== data.path) await admin.storage.from("preloads").remove([old.preload_path]);
    await admin.from("access_passwords").update({ preload_path: data.path, preload_name: data.name }).eq("id", data.id);
    return { ok: true as const };
  });

export const getPreload = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<GateSession>(sessionConfig());
  if (!session.data.pid) return null;
  const admin = await db();
  const { data } = await admin.from("access_passwords").select("preload_path, preload_name, frozen").eq("id", session.data.pid).maybeSingle();
  if (!data?.preload_path || data.frozen) return null;
  const { data: signed } = await admin.storage.from("preloads").createSignedUrl(data.preload_path, 60 * 60);
  if (!signed) return null;
  return { url: signed.signedUrl, name: data.preload_name ?? "Preloaded file" };
});
