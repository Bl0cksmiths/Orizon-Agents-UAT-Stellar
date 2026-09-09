# Live-site findings

Defects observed on https://orizons.xyz while authoring the UAT suite. Each was
found by reading the frontend source and comparing it against what the
deployment actually serves, so each is reproducible without running the suite.

None of these are blocking, and none are asserted as failures by the suite —
a UAT suite that ships red on day one teaches people to ignore it. They are
recorded here so they can be fixed and then locked in with an assertion.

## 1. `/favicon.ico` returns 404

The page correctly declares `<link rel="icon" href="/icon.png">`, but Chromium
probes `/favicon.ico` unconditionally and that path is not served. It is the
only failed request on an otherwise clean load, and it had to be allowlisted in
the console/network-error assertion (`tests/fixtures.ts`, `collectConsoleErrors`)
to keep that test meaningful.

**Fix:** add a `/favicon.ico` route or a static file in `public/`.

## 2. `/app/flow` and `/app/events` ship the default page title

Both are client components with no per-route `metadata` export, so Next's title
template never overrides the layout default and both render
`<title>Console — Orizon Agents</title>`. Every other console route sets its own.

**Fix:** export `metadata` from each route, or move the title into a shared
server component wrapper.

## 3. Skills validation errors can never render on `/app/register`

`lib/register-validation.ts` defines a "16 skills maximum" message and a
per-token charset message, but neither can reach the screen:

- `components/ui/skills-input.tsx` sanitises invalid characters as you type and
  refuses to add a 17th chip client-side, so the invalid states never occur; and
- `app/app/register/page.tsx` never calls `touch("skills")` — there is no
  `onBlur` wiring for that field — so even if the state occurred, the error text
  is gated behind a `touched` flag that is never set.

Only `aria-invalid` on the field reflects the cap. The validation messages are
dead code.

**Fix:** wire `touch("skills")`, or delete the unreachable messages so the
validation module stops implying coverage it does not have.

## 4. Overview cannot distinguish a transient 500 from a terminal 404

`app/app/page.tsx` drives its own state around `usePolling` rather than using
`useFetch`, so it does not get `useFetch`'s transient-error retry indicator.
Every other data-backed console route shows a "retrying…" state for a 5xx and a
terminal error for a 404; Overview shows the same thing for both.

**Fix:** move Overview onto `useFetch`, which also closes the unguarded manual
`retry()` race noted in the frontend audit.
