// Is the credit system visible to the user?
//
// One switch, read by everything that would otherwise put credits in front of
// somebody: the sidebar balance, the guided tours, the per-action cost labels
// and the bulk-run confirmations. They have to agree - a confirmation that
// quotes a price while the balance it spends from is hidden is worse than
// either choice on its own.
//
// This is presentation only. Charging, quotas and the server-side balance are
// untouched; actions still cost what they cost and still fail when the balance
// runs out. Hiding the numbers does not stop the meter.
//
// Turn back on: NEXT_PUBLIC_SHOW_CREDITS=1 in .env.local, then restart. It has
// to be NEXT_PUBLIC_ - every surface below this switch is a client component,
// and only NEXT_PUBLIC_ vars are inlined into the browser bundle.
const SHOW_CREDITS = process.env.NEXT_PUBLIC_SHOW_CREDITS === "1";

module.exports = { SHOW_CREDITS };
