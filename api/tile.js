/* GET /api/tile?n=<product name>&c=<category>&t=<strain type>
   A drawn product tile for anything we have no photograph of.

   Six hundred SKUs will never all have real photos, and a menu where half the
   cards share one grey leaf reads as broken rather than as minimal. So each
   unmatched product gets its own card instead: the colour, the angle of the
   light and the pattern are all derived from the product's own name, which
   means the same product always looks the same and no two neighbours look
   alike. It is honest — it never pretends to be a photograph of the goods —
   and it costs one small SVG that caches for a year.                          */

const CAT = [
  [/\b(joint|pre-?roll|preroll|blunt|cone)\b/, "joint"],
  [/\b(vape|cart|cartridge|pod|disposable|510|battery)\b/, "vape"],
  [/\b(edible|gummy|gummies|cookie|brownie|chocolate|candy|cake)\b/, "edible"],
  [/\b(beer|lager|weizen|ipa|stout|cider|wine|whisky|cocktail)\b/, "bottle"],
  [/\b(drink|soda|cola|coke|tea|coffee|juice|water|shake|smoothie|latte)\b/, "cup"],
  [/\b(food|rice|noodle|curry|burger|chicken|pork|beef|salad|soup|pizza|fries)\b/, "plate"],
  [/\b(grinder|lighter|paper|rolling|bong|pipe|rig|tray|filter|tip|storage|accessor)/, "tool"],
  [/\b(shirt|tee|hoodie|cap|hat|merch|sticker|tote|sock)/, "shirt"],
  [/\b(hash|rosin|resin|wax|shatter|kief|dab|concentrate)\b/, "hash"],
];

/* FNV-1a — small, stable, and identical run to run, which is the whole point:
   a product must not change colour between page loads. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function esc(s) {
  return String(s).replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Glyphs are deliberately simple silhouettes — at card size a detailed drawing
   turns to mud, and a clear shape reads as "this is a drink" instantly. */
function glyph(kind) {
  switch (kind) {
    case "joint":  return '<path d="M96 232 L232 96 l22 22 L118 254 Z"/><circle cx="243" cy="85" r="17" opacity=".75"/>';
    case "vape":   return '<rect x="150" y="70" width="52" height="200" rx="24"/><rect x="164" y="44" width="24" height="30" rx="10" opacity=".7"/>';
    case "edible": return '<circle cx="176" cy="176" r="86"/><circle cx="146" cy="150" r="13" opacity=".45"/><circle cx="205" cy="168" r="11" opacity=".45"/><circle cx="168" cy="208" r="12" opacity=".45"/>';
    case "bottle": return '<path d="M154 40h44v46l26 42v144a16 16 0 0 1-16 16h-64a16 16 0 0 1-16-16V128l26-42Z"/>';
    case "cup":    return '<path d="M108 108h136l-16 148a20 20 0 0 1-20 18h-64a20 20 0 0 1-20-18Z"/><rect x="100" y="84" width="152" height="20" rx="10" opacity=".75"/>';
    case "plate":  return '<circle cx="176" cy="176" r="96" opacity=".55"/><circle cx="176" cy="176" r="62"/>';
    case "tool":   return '<circle cx="176" cy="176" r="88" opacity=".5"/><circle cx="176" cy="176" r="34"/><rect x="166" y="60" width="20" height="40" rx="8"/><rect x="166" y="252" width="20" height="40" rx="8"/><rect x="60" y="166" width="40" height="20" rx="8"/><rect x="252" y="166" width="40" height="20" rx="8"/>';
    case "shirt":  return '<path d="M116 70l60 26 60-26 46 34-26 44-24-12v128H120V136l-24 12-26-44Z"/>';
    case "hash":   return '<path d="M96 200l40-72 40 40 36-56 44 88Z"/><circle cx="176" cy="236" r="52" opacity=".45"/>';
    default: {
      /* Seven tapered blades fanned around a stem. Built from rotated ellipses
         rather than one hand-drawn path — at 17% opacity behind a title, a
         clean silhouette reads as a leaf where a detailed one reads as a smudge. */
      const blades = [
        [0, 104, 21], [30, 92, 19], [-30, 92, 19],
        [60, 74, 16], [-60, 74, 16], [88, 52, 13], [-88, 52, 13],
      ]
        .map(([deg, len, wid]) =>
          `<ellipse cx="176" cy="${248 - len}" rx="${wid}" ry="${len}" transform="rotate(${deg} 176 248)"/>`)
        .join("");
      return blades + '<rect x="171" y="240" width="10" height="58" rx="5"/>';
    }
  }
}

export default function handler(req, res) {
  const q = req.query || {};
  const rawName = String(q.n || q.name || "DANK").slice(0, 80);
  const cat = String(q.c || q.category || "").slice(0, 40);
  const type = String(q.t || q.type || "").slice(0, 24);

  const probe = (rawName + " " + cat).toLowerCase();
  let kind = "leaf";
  for (const [re, k] of CAT) { if (re.test(probe)) { kind = k; break; } }

  const h = hash(rawName.toLowerCase().trim() || "dank");
  /* Unsigned shifts throughout: >> on a hash above 2^31 goes negative and
     quietly produces a negative saturation, which renders as a dead grey. */
  const hue = h % 360;
  const hue2 = (hue + 26 + ((h >>> 9) % 30)) % 360;
  const sat = 44 + ((h >>> 3) % 26);       // 44–69%
  const lig = 16 + ((h >>> 7) % 12);       // 16–27% — always dark enough for white text
  const ang = 100 + ((h >>> 11) % 80);
  const bx = 24 + ((h >>> 5) % 52);        // where the glow sits
  const by = 18 + ((h >>> 13) % 40);
  /* Unique gradient ids — several of these can end up inlined in one page. */
  const u = "t" + h.toString(36);

  /* Strip the "( weed )" style prefix for display — the customer already knows
     which shop they are in, and the bracket eats a third of the card. */
  const label = rawName.replace(/^\s*\([^)]*\)\s*/, "").trim() || rawName;

  const svg =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 352 264" width="352" height="264" role="img" aria-label="${esc(label)}">
<defs>
<linearGradient id="${u}g" gradientTransform="rotate(${ang} .5 .5)">
<stop offset="0" stop-color="hsl(${hue} ${sat}% ${lig + 9}%)"/>
<stop offset="1" stop-color="hsl(${hue2} ${sat - 8}% ${Math.max(8, lig - 7)}%)"/>
</linearGradient>
<radialGradient id="${u}w" cx="${bx}%" cy="${by}%" r="72%">
<stop offset="0" stop-color="hsl(${hue} 90% 66%)" stop-opacity=".34"/>
<stop offset="1" stop-color="hsl(${hue} 90% 66%)" stop-opacity="0"/>
</radialGradient>
<linearGradient id="${u}f" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#000" stop-opacity="0"/>
<stop offset="1" stop-color="#000" stop-opacity=".55"/>
</linearGradient>
</defs>
<rect width="352" height="264" fill="url(#${u}g)"/>
<rect width="352" height="264" fill="url(#${u}w)"/>
<g transform="translate(176 118) scale(.62) translate(-176 -176)" fill="#fff" opacity=".17">${glyph(kind)}</g>
<rect width="352" height="264" fill="url(#${u}f)"/>
<text x="176" y="214" text-anchor="middle" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="23" font-weight="800" fill="#fff" opacity=".95">${esc(label.length > 20 ? label.slice(0, 19) + "…" : label)}</text>
${type || cat ? `<text x="176" y="238" text-anchor="middle" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="13" font-weight="600" fill="#fff" opacity=".62" letter-spacing="1.4">${esc((type || cat).toUpperCase().slice(0, 22))}</text>` : ""}
</svg>`;

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).send(svg);
}
