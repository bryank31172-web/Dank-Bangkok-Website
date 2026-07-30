/* Wallet / store-credit helper. Balance is keyed by customer phone and
   stored in the shared store (Redis when configured). Top-ups add a +10%
   bonus; wallet can then pay for orders. */
import { getJSON, setJSON } from "./_store.js";
import { normPhone } from "./_phone.js";

const YEAR = 60 * 60 * 24 * 365;
const key = (p) => "wallet:" + normPhone(p);

/* The key this file used before it shared a normaliser with the rest of the
   API: whitespace stripped and nothing else. "081-234-5678" and "0812345678"
   therefore built two different wallets for one customer, and whichever one
   they had topped up became invisible the moment they typed their number the
   other way. Real money is sitting under these keys on the live deployment. */
const legacyKey = (p) => "wallet:" + String(p || "").replace(/\s+/g, "");

/* Every read goes through here so the migration happens wherever a wallet is
   first touched — not just in getWallet(). Doing it in getWallet() alone would
   have been worse than not doing it at all: a credit() or debit() reading the
   new key directly would have found nothing, started a fresh zero balance, and
   left the old money stranded for good.

   The new key is written before the old one is emptied. If the process dies
   between the two writes the balance exists twice, but the legacy record is
   only ever read when the new key is missing — so the customer keeps their
   money either way, which is the failure we care about. */
async function load(phone) {
  const k = key(phone);
  const w = await getJSON(k);
  if (w) return { k, w };

  const lk = legacyKey(phone);
  if (lk !== k) {
    const old = await getJSON(lk);
    if (old && (old.balance || (old.history || []).length)) {
      const moved = { ...old, migratedFrom: lk, migratedAt: Date.now() };
      await setJSON(k, moved, YEAR);
      await setJSON(lk, { balance: 0, history: [], movedTo: k, movedAt: Date.now() }, YEAR);
      console.log("wallet migrated to normalised key:", lk, "→", k);
      return { k, w: moved };
    }
  }
  return { k, w: { balance: 0, history: [] } };
}

export async function getWallet(phone) {
  return (await load(phone)).w;
}
export async function getBalance(phone) {
  return (await getWallet(phone)).balance || 0;
}
export async function credit(phone, amount, reason) {
  const { k, w } = await load(phone);
  w.balance = Math.round(w.balance + amount);
  w.history.unshift({ t: "credit", amount: Math.round(amount), reason, at: Date.now() });
  w.history = w.history.slice(0, 50);
  await setJSON(k, w, YEAR);
  return w.balance;
}
export async function debit(phone, amount, reason) {
  const { k, w } = await load(phone);
  const amt = Math.round(Number(amount));
  // reject non-finite / non-positive amounts so a NaN can't bypass the balance check
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: "bad amount", balance: w.balance };
  if (w.balance < amt) return { ok: false, balance: w.balance };
  w.balance -= amt;
  w.history.unshift({ t: "debit", amount: amt, reason, at: Date.now() });
  w.history = w.history.slice(0, 50);
  await setJSON(k, w, YEAR);
  return { ok: true, balance: w.balance };
}
