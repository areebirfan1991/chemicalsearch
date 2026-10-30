import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import ChemSearch from "@/components/ChemSearch";
import { getAccess, login, logout } from "@/lib/gate.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chem Search — Search import records across spreadsheets" },
      { name: "description", content: "Upload Excel files and instantly search chemical import records by GD number, item, importer, supplier and more." },
      { property: "og:title", content: "Chem Search" },
      { property: "og:description", content: "Upload Excel files and instantly search chemical import records." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: () => getAccess(),
  component: Page,
});

function Page() {
  const { status } = Route.useLoaderData();
  if (status === "locked") return <Login />;
  if (status === "blocked") return <Blocked />;
  return <ChemSearch />;
}

function Login() {
  const router = useRouter();
  const doLogin = useServerFn(login);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        className="w-full max-w-sm rounded-xl border border-border bg-card p-8"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const password = new FormData(e.currentTarget).get("password") as string;
          const r = await doLogin({ data: { password } });
          setBusy(false);
          if (r.ok && r.admin) router.navigate({ to: "/admin" });
          else if (r.ok) router.invalidate();
          else setError(true);
        }}
      >
        <h1 className="text-xl font-semibold text-foreground">ChemSearch</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter your access password</p>
        <input
          name="password"
          type="password"
          autoFocus
          className="mt-6 w-full rounded-md border border-border bg-input px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
        {error && <p className="mt-2 text-sm text-destructive">Incorrect password</p>}
        <button
          disabled={busy}
          className="mt-4 w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}

function Blocked() {
  const router = useRouter();
  const doLogout = useServerFn(logout);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 px-4 backdrop-blur">
      <div role="alertdialog" aria-modal="true" className="w-full max-w-md rounded-xl border border-destructive/50 bg-card p-8 text-center">
        <h2 className="text-2xl font-semibold text-foreground">Subscription expired</h2>
        <p className="mt-3 text-muted-foreground">
          Please renew your subscription to continue using ChemSearch.
        </p>
        <button
          onClick={async () => {
            await doLogout();
            router.invalidate();
          }}
          className="mt-6 text-sm text-muted-foreground underline"
        >
          Use a different password
        </button>
      </div>
    </div>
  );
}
