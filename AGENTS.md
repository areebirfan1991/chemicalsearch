<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Site access passwords live in the access_passwords table (service-role only, no RLS policies), managed from /admin; the admin flag and logged-in password id live in the encrypted session cookie, checked in gate.functions.ts.
- There is exactly one password entry point: the shared login page. The admin panel route must not grow its own login form — it redirects unauthenticated visitors to the shared login page instead.
- Spreadsheet import logic lives in a browser-safe reader module; HTML-based Excel exports are decoded in bounded chunks to avoid SheetJS's whole-file string conversion in Chrome.
- Customer file selections share one sequential parsing queue and append results as each file finishes, so separate phone selections cannot start competing parsers.
