import test from 'node:test';
import assert from 'node:assert/strict';
import {POSTS,publishedPosts,findPost,markdownToHtml} from '../api/_blog.js';
import {renderBlogIndex,renderBlogPost,renderSitemap} from '../api/_seo.js';

const live={slug:'test-post',title:'Test <post>',description:'A test.',date:'2026-10-01',image:'/promo-first.jpg',lang:'th',draft:false,body:'## Heading\n\nHello **world** [shop](/shop)\n\n- one\n- two'};
function withPost(fn){POSTS.push(live);try{fn()}finally{POSTS.pop()}}

test('drafts never appear',()=>{
 const drafts=POSTS.filter(p=>p.draft).map(p=>p.slug);
 for(const slug of drafts){assert.equal(findPost(slug),null);assert.equal(renderBlogPost(slug),null);assert.ok(!renderSitemap('blog').includes(slug));}
});
test('every post has a unique, URL-safe slug and an ISO date',()=>{
 const slugs=POSTS.map(p=>p.slug);
 assert.equal(new Set(slugs).size,slugs.length);
 for(const p of POSTS){assert.match(p.slug,/^[a-z0-9]+(-[a-z0-9]+)*$/);assert.match(p.date,/^\d{4}-\d{2}-\d{2}$/);}
});
test('empty blog stays out of search indexes',()=>{
 if(publishedPosts().length)return;
 assert.match(renderBlogIndex(),/noindex/);
});
test('published post renders with article schema, lang and escaping',()=>withPost(()=>{
 const html=renderBlogPost('test-post');
 assert.match(html,/<html lang="th">/);
 assert.match(html,/"@type":"BlogPosting"/);
 assert.match(html,/og:type" content="article"/);
 assert.match(html,/Test &lt;post&gt;/);
 assert.match(html,/<h2>Heading<\/h2>/);
 assert.match(renderBlogIndex(),/href="\/blog\/test-post\/"/);
 assert.doesNotMatch(renderBlogIndex(),/noindex/);
 assert.match(renderSitemap('blog'),/<loc>https:\/\/www\.dankbangkok\.com\/blog\/test-post\/<\/loc><lastmod>2026-10-01<\/lastmod>/);
}));
test('markdown escapes HTML and refuses javascript: links',()=>{
 const html=markdownToHtml('<script>x</script> [a](javascript:alert(1))');
 assert.ok(!html.includes('<script>'));
 assert.ok(!html.includes('javascript:'));
 assert.equal(markdownToHtml('- a\n- b'),'<ul><li>a</li><li>b</li></ul>');
 assert.equal(markdownToHtml('1. a\n2. b'),'<ol><li>a</li><li>b</li></ol>');
});
