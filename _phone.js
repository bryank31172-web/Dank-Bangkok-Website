/* One phone normaliser for the whole API.

   Everything that is keyed on a customer's phone number has to agree on what
   "the same number" means. It didn't: the wallet stripped whitespace only,
   while the member list and the POS CRM slice stripped everything but digits.
   So a customer who typed 08x-xxx-xxxx at checkout and 08xxxxxxxx on the member
   screen owned two different wallets, and the credit they had topped up
   vanished from their own view — the money was still there, under a key nothing
   else in the system would ever build again.

   Digits only, and a leading Thai country code folded back to the local 0 form,
   so "+66 81 234 5678", "081-234-5678" and "081 234 5678" all land on the same
   record. Local mobile numbers here always start with 0, so a leading 66 is
   always the country code and never the start of the subscriber number.     */
export function normPhone(p) {
  return String(p ?? "")
    .replace(/[^0-9]/g, "")
    .replace(/^66/, "0");
}
