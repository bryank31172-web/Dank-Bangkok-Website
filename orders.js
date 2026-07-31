/* GET /api/pay-config — tells the storefront which online gateways are live,
   so checkout can show exactly the payment options that are configured. */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    omise: Boolean(process.env.OMISE_SECRET_KEY && process.env.OMISE_PUBLIC_KEY),
    omisePublicKey: process.env.OMISE_PUBLIC_KEY || "",
    twoc2p: Boolean(process.env.TWOC2P_MERCHANT_ID && process.env.TWOC2P_SECRET),
    gbp: Boolean(process.env.GBP_SECRET_KEY),
  });
}
