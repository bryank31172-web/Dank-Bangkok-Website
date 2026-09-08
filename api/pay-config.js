/* GET /api/pay-config — tells the storefront which online gateways are live,
   so checkout can show exactly the payment options that are configured. */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    /* Beam first: it is the one Bryan chose, and PromptPay through it is 0%.
       Only the booleans go to the browser — never a key. Omise's public key is
       the one exception and it is public by design, because card details are
       tokenised in the browser before they ever reach us. */
    beam: Boolean(process.env.BEAM_MERCHANT_ID && process.env.BEAM_API_KEY),
    omise: Boolean(process.env.OMISE_SECRET_KEY && process.env.OMISE_PUBLIC_KEY),
    omisePublicKey: process.env.OMISE_PUBLIC_KEY || "",
    twoc2p: Boolean(process.env.TWOC2P_MERCHANT_ID && process.env.TWOC2P_SECRET),
    gbp: Boolean(process.env.GBP_SECRET_KEY),
  });
}
