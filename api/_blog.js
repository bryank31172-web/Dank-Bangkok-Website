// Blog articles for /blog/.
//
// Two sources, merged by slug:
//   1. SEED_POSTS in _blog-posts.js — shipped with the code.
//   2. The "blog:posts" record in the site database — written by the blog
//      editor at /blog-admin (owner login). An edit there replaces the seed
//      post with the same slug; `deleted` hides a seed post.
//
// A post is public when draft is false and its date has arrived in Bangkok.
// Future dates are how the 5th / 15th / 25th publishing schedule works:
// nothing has to be pressed on the day.
//
// Markdown supported in `body`: ## to #### headings, paragraphs, - lists,
// 1. lists, > quotes, **bold**, *italic*, [link](https://…), ![alt](/assets/…).

import { getJSON, setJSON } from "./_store.js";
import { SEED_POSTS } from "./_blog-posts.js";

export const BLOG_KEY = "blog:posts";
const BLOG_TTL = 60 * 60 * 24 * 365 * 10;
const CACHE_MS = 30 * 1000;

let stored = { posts: {}, deleted: [] };
let loadedAt = 0;

function normaliseStore(value) {
  const posts = value && typeof value.posts === "object" && value.posts ? value.posts : {};
  const deleted = Array.isArray(value?.deleted) ? value.deleted.map(String) : [];
  return { posts, deleted };
}

/* Pull the editor's posts from the database. Called by the page handler before
   rendering; a failing database leaves the seed posts showing, never an error. */
export async function refreshPosts({ force = false } = {}) {
  if (!force && Date.now() - loadedAt < CACHE_MS) return;
  try { stored = normaliseStore(await getJSON(BLOG_KEY)); } catch (e) {}
  loadedAt = Date.now();
}

export async function readStore() {
  return normaliseStore(await getJSON(BLOG_KEY));
}

export async function writeStore(value) {
  const clean = normaliseStore(value);
  await setJSON(BLOG_KEY, clean, BLOG_TTL);
  stored = clean;
  loadedAt = Date.now();
}

export function bangkokToday(now = Date.now()) {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/* Every post, drafts and scheduled ones included, with where it came from. */
export function allPosts(source = stored) {
  const bySlug = new Map();
  for (const post of SEED_POSTS) bySlug.set(post.slug, { ...post, source: "code" });
  for (const slug of source.deleted) bySlug.delete(slug);
  for (const [slug, post] of Object.entries(source.posts)) {
    if (post && typeof post === "object") bySlug.set(slug, { ...post, slug, source: "editor" });
  }
  return [...bySlug.values()]
    .filter((post) => post.slug && post.title)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function isLive(post, today = bangkokToday()) {
  return !post.draft && String(post.date || "") <= today;
}

export function publishedPosts({ includeDrafts = false, today } = {}) {
  const day = today || bangkokToday();
  return allPosts().filter((post) => includeDrafts || isLive(post, day));
}

export function findPost(slug, options) {
  return publishedPosts(options).find((post) => post.slug === slug) || null;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value, max) => String(value ?? "").trim().slice(0, max);

/* The only shape the editor may store. Anything else in the request is dropped. */
export function cleanPost(input) {
  const post = {
    slug: text(input?.slug, 120).toLowerCase(),
    title: text(input?.title, 200),
    metaTitle: text(input?.metaTitle, 120),
    description: text(input?.description, 320),
    keyword: text(input?.keyword, 120),
    date: text(input?.date, 10),
    updated: text(input?.updated, 10),
    image: text(input?.image, 500),
    imageAlt: text(input?.imageAlt, 200),
    lang: input?.lang === "th" ? "th" : "en",
    draft: input?.draft !== false,
    body: String(input?.body ?? "").slice(0, 60000),
    faqs: (Array.isArray(input?.faqs) ? input.faqs : []).slice(0, 12)
      .map((faq) => ({ q: text(faq?.q, 300), a: text(faq?.a, 1500) }))
      .filter((faq) => faq.q && faq.a),
    images: (Array.isArray(input?.images) ? input.images : []).slice(0, 8)
      .map((img) => ({
        placement: text(img?.placement, 200),
        src: text(img?.src, 500),
        prompt: text(img?.prompt, 1500),
        alt: text(img?.alt, 200),
        title: text(img?.title, 120),
        description: text(img?.description, 300),
      })),
  };
  const errors = [];
  if (!SLUG.test(post.slug)) errors.push("slug: lowercase letters, numbers and hyphens only");
  if (!post.title) errors.push("title is required");
  if (!DATE.test(post.date)) errors.push("date must be YYYY-MM-DD");
  if (post.updated && !DATE.test(post.updated)) errors.push("updated must be YYYY-MM-DD");
  return { post, errors };
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

function inline(text, images = []) {
  return escapeHtml(text)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
      const meta = images.find((img) => img.src && escapeHtml(img.src) === src);
      return `<img src="${safeHref(src)}" alt="${alt}"${meta?.title ? ` title="${escapeHtml(meta.title)}"` : ""} loading="lazy">`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const url = safeHref(href);
      const external = /^https?:\/\//i.test(url) && !/^https?:\/\/(www\.)?dankbangkok\.com/i.test(url);
      return `<a href="${url}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function markdownToHtml(markdown, images = []) {
  const md = (t) => inline(t, images);
  const blocks = String(markdown || "").replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  return blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return "";
    const heading = lines[0].match(/^(#{2,4})\s+(.+)$/);
    if (heading && lines.length === 1) return `<h${heading[1].length}>${md(heading[2])}</h${heading[1].length}>`;
    if (heading) return `<h${heading[1].length}>${md(heading[2])}</h${heading[1].length}>\n${markdownToHtml(lines.slice(1).join("\n"), images)}`;
    if (lines.every((line) => /^[-*]\s+/.test(line))) return `<ul>${lines.map((line) => `<li>${md(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
    if (lines.every((line) => /^\d+[.)]\s+/.test(line))) return `<ol>${lines.map((line) => `<li>${md(line.replace(/^\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
    if (lines.every((line) => line.startsWith(">"))) return `<blockquote>${md(lines.map((line) => line.replace(/^>\s?/, "")).join(" "))}</blockquote>`;
    if (lines.length === 1 && /^!\[[^\]]*\]\([^)\s]+\)$/.test(lines[0])) return `<figure>${md(lines[0])}</figure>`;
    return `<p>${md(lines.join(" "))}</p>`;
  }).join("\n");
}
