// Blog articles for /blog/.
//
// To add an article: copy the example below, give it a new `slug` (lowercase,
// hyphens, no spaces — it becomes the URL /blog/<slug>/), write the body in
// Markdown, and set `draft: false` when it is ready to go live. Drafts never
// appear on the site or in the sitemap.
//
// Markdown supported in `body`: ## and ### headings, paragraphs, - lists,
// 1. lists, > quotes, **bold**, *italic*, [link](https://…), ![alt](/assets/…).

export const POSTS = [
  {
    slug: "welcome-to-the-dank-bkk-blog",
    title: "Welcome to the DANK BKK blog",
    description: "News, guides and updates from DANK BKK in Bangkok.",
    date: "2026-10-16",
    updated: "",
    image: "/promo-first.jpg",
    lang: "en",
    draft: true,
    body: `
This is an example article. Replace this text with the real article, then set
**draft: false** to publish it.

## A section heading

Write paragraphs separated by a blank line.

- A list item
- Another list item

[Browse products](/products/)
`,
  },
];

export function publishedPosts({ includeDrafts = false } = {}) {
  return POSTS
    .filter((post) => post.slug && post.title && (includeDrafts || !post.draft))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function findPost(slug, options) {
  return publishedPosts(options).find((post) => post.slug === slug) || null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(url) {
  const value = String(url).trim();
  return /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(value) ? value : "#";
}

function inline(text) {
  return escapeHtml(text)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${safeHref(src)}" alt="${alt}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const url = safeHref(href);
      const external = /^https?:\/\//i.test(url) && !/^https?:\/\/(www\.)?dankbangkok\.com/i.test(url);
      return `<a href="${url}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function markdownToHtml(markdown) {
  const blocks = String(markdown || "").replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  return blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return "";
    const heading = lines[0].match(/^(#{2,3})\s+(.+)$/);
    if (heading && lines.length === 1) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
    if (lines.every((line) => /^[-*]\s+/.test(line))) return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
    if (lines.every((line) => /^\d+[.)]\s+/.test(line))) return `<ol>${lines.map((line) => `<li>${inline(line.replace(/^\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
    if (lines.every((line) => line.startsWith(">"))) return `<blockquote>${inline(lines.map((line) => line.replace(/^>\s?/, "")).join(" "))}</blockquote>`;
    if (lines.length === 1 && /^!\[[^\]]*\]\([^)\s]+\)$/.test(lines[0])) return `<figure>${inline(lines[0])}</figure>`;
    return `<p>${inline(lines.join(" "))}</p>`;
  }).join("\n");
}
