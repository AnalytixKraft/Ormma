/* The first-run page's one script (desktop/lib/first-run.mjs): once the
 * password is set, wait for Ormma itself to answer on this address — the
 * app takes the port over from the first-run page — then open it. */
const starting = document.getElementById("starting");
if (starting) {
  const since = Date.now();
  const check = async () => {
    try {
      const res = await fetch("/healthz", { cache: "no-store" });
      const body = await res.json();
      if (res.ok && !body.setup) return location.replace("/");
    } catch {
      // Between the two: nothing answers for a moment.
    }
    if (Date.now() - since < 120_000) setTimeout(check, 700);
  };
  setTimeout(check, 700);
}
