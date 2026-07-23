/* Wallet / store-credit helper. Balance is keyed by customer phone and
   stored in the shared store (Redis when configured). Top-ups add a +10%
   bonus; wallet can then pay for orders. */
import { getJSON, setJSON } from "./_store.js";

const YEAR = 60 * 60 * 24 * 365;
const key = (p) => "wallet:" + String(p || "").replace(/\s+/g, "");

export async function getWallet(phone) {
  return (await getJSON(key(phone))) || { balance: 0, history: [] };
}
export async function getBalance(phone) {
  return (await getWallet(phone)).balance || 0;
}
export async function credit(phone, amount, reason) {
  const k = key(phone);
  const w = (await getJSON(k)) || { balance: 0, history: [] };
  w.balance = Math.round(w.balance + amount);
  w.history.unshift({ t: "credit", amount: Math.round(amount), reason, at: Date.now() });
  w.history = w.history.slice(0, 50);
  await setJSON(k, w, YEAR);
  return w.balance;
}
export async function debit(phone, amount, reason) {
  const k = key(phone);
  const amt = Math.round(Number(amount));
  const w = (await getJSON(k)) || { balance: 0, history: [] };
  // reject non-finite / non-positive amounts so a NaN can't bypass the balance check
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: "bad amount", balance: w.balance };
  if (w.balance < amt) return { ok: false, balance: w.balance };
  w.balance -= amt;
  w.history.unshift({ t: "debit", amount: amt, reason, at: Date.now() });
  w.history = w.history.slice(0, 50);
  await setJSON(k, w, YEAR);
  return { ok: true, balance: w.balance };
}
