import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  adminStatus,
  adminLogin,
  adminLogout,
  listPasswords,
  addPassword,
  deletePassword,
  setFrozen,
  preloadUploadUrl,
  setPreload,
} from "@/lib/gate.functions";

function PreloadControl({ id, name }: { id: string; name: string | null }) {
  const router = useRouter();
  const getUrl = useServerFn(preloadUploadUrl);
  const save = useServerFn(setPreload);
  const [status, setStatus] = useState("");
  const upload = async (file: File) => {
    try {
      setStatus(`Uploading ${file.name}… keep this page open`);
      const { path, token } = await getUrl({ data: { id, name: file.name } });
      const { error } = await supabase.storage.from("preloads").uploadToSignedUrl(path, token, file);
      if (error) throw error;
      await save({ data: { id, path, name: file.name } });
      setStatus("");
      router.invalidate();
    } catch (e) {
      setStatus(`Upload failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{name ? `Preloaded: ${name}` : "No preloaded file"}</span>
      <label className="cursor-pointer text-primary underline">
        {name ? "Replace" : "Add file"}
        <input type="file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
      </label>
      {name && (
        <button className="text-destructive underline" onClick={async () => { await save({ data: { id, path: null, name: null } }); router.invalidate(); }}>
          Remove
        </button>
      )}
      {status && <span className="w-full text-foreground">{status}</span>}
    </div>
  );
}

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Chem Search" },
      { name: "description", content: "Manage Chem Search access passwords." },
      { property: "og:title", content: "Chem Search Admin" },
      { property: "og:description", content: "Manage Chem Search access passwords." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async () => {
    const { admin } = await adminStatus();
    return { admin, rows: admin ? await listPasswords() : [] };
  },
  component: AdminPage,
});

function AdminPage() {
  const { admin } = Route.useLoaderData();
  return admin ? <Panel /> : <AdminLogin />;
}

function AdminLogin() {
  const router = useRouter();
  const doLogin = useServerFn(adminLogin);
  const [error, setError] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        className="w-full max-w-sm rounded-xl border border-border bg-card p-8"
        onSubmit={async (e) => {
          e.preventDefault();
          const password = new FormData(e.currentTarget).get("password") as string;
          const r = await doLogin({ data: { password } });
          if (r.ok) router.invalidate();
          else setError(true);
        }}
      >
        <h1 className="text-xl font-semibold text-foreground">Admin Panel</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter admin password</p>
        <input
          name="password"
          type="password"
          autoFocus
          className="mt-6 w-full rounded-md border border-border bg-input px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
        {error && <p className="mt-2 text-sm text-destructive">Incorrect password</p>}
        <button className="mt-4 w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">
          Enter
        </button>
      </form>
    </div>
  );
}

function Panel() {
  const { rows } = Route.useLoaderData();
  const router = useRouter();
  const add = useServerFn(addPassword);
  const del = useServerFn(deletePassword);
  const freeze = useServerFn(setFrozen);
  const out = useServerFn(adminLogout);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">Admin Panel</h1>
          <div className="flex gap-2">
          <a href="/" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
            Open search
          </a>
          <button
            onClick={async () => { await out(); router.invalidate(); }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Log out
          </button>
          </div>
        </div>

        <form
          className="mt-6 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            const r = await add({ data: { password: value } });
            if (!r.ok) return setError(r.error);
            setValue("");
            router.invalidate();
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="New password, e.g. chemical@777"
            className="flex-1 rounded-md border border-border bg-input px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
          <button className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">
            Add password
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <span className="font-mono text-foreground">{r.password}</span>
                <PreloadControl id={r.id} name={r.preload_name} />
              </div>
              <span className={`text-xs ${r.frozen ? "text-destructive" : "text-primary"}`}>
                {r.frozen ? "Frozen" : "Active"}
              </span>
              <button
                onClick={async () => { await freeze({ data: { id: r.id, frozen: !r.frozen } }); router.invalidate(); }}
                className="rounded-md border border-border px-3 py-1 text-sm text-foreground hover:bg-muted"
              >
                {r.frozen ? "Unfreeze" : "Freeze"}
              </button>
              <button
                onClick={async () => {
                  if (!confirm(`Delete ${r.password}?`)) return;
                  await del({ data: { id: r.id } });
                  router.invalidate();
                }}
                className="rounded-md border border-destructive/50 px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
              >
                Delete
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="px-4 py-6 text-center text-muted-foreground">No passwords</li>}
        </ul>
      </div>
    </div>
  );
}
