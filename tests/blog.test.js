import test from 'node:test';
import assert from 'node:assert/strict';
import {SEED_POSTS} from '../api/_blog-posts.js';
import {allPosts,publishedPosts,findPost,markdownToHtml,cleanPost,isLive,writeStore,refreshPosts} from '../api/_blog.js';
import {renderBlogIndex,renderBlogPost,renderSitemap} from '../api/_seo.js';

const live={slug:'test-post',title:'Test <post>',metaTitle:'Meta title',description:'A test.',keyword:'weed shop',date:'2026-10-01',image:'/promo-first.jpg',imageAlt:'Box',lang:'th',draft:false,body:'## Heading\n\nHello **world** [shop](/shop)\n\n- one\n- two',faqs:[{q:'Q1?',a:'A1.'}],images:[]};
function withPost(post,fn){SEED_POSTS.push(post);try{fn()}finally{SEED_POSTS.pop()}}

test('drafts and future-dated posts stay hidden',()=>{
 withPost({...live,slug:'draft-post',draft:true},()=>assert.equal(findPost('draft-post'),null));
 withPost({...live,slug:'future-post',date:'2999-01-05'},()=>{
  assert.equal(findPost('future-post'),null);
  assert.ok(!renderSitemap('blog').includes('future-post'));
  assert.ok(findPost('future-post',{includeDrafts:true}));
 });
 assert.equal(isLive({draft:false,date:'2026-10-25'},'2026-10-24'),false);
 assert.equal(isLive({draft:false,date:'2026-10-25'},'2026-10-25'),true);
});
test('every seed post has a unique, URL-safe slug and an ISO date',()=>{
 const slugs=SEED_POSTS.map(p=>p.slug);
 assert.equal(new Set(slugs).size,slugs.length);
 for(const p of SEED_POSTS){assert.equal(cleanPost(p).errors.length,0,p.slug);}
});
test('published post renders meta title, lang, FAQ schema, shop CTA and escaping',()=>withPost(live,()=>{
 const html=renderBlogPost('test-post');
 assert.match(html,/<html lang="th">/);
 assert.match(html,/<title>Meta title<\/title>/);
 assert.match(html,/"@type":"BlogPosting"/);
 assert.match(html,/"@type":"FAQPage"/);
 assert.match(html,/og:type" content="article"/);
 assert.match(html,/Test &lt;post&gt;/);
 assert.match(html,/<h2>Heading<\/h2>/);
 assert.match(html,/ดูเส้นทาง/);
 assert.match(renderBlogIndex(),/href="\/blog\/test-post\/"/);
 assert.match(renderSitemap('blog'),/<loc>https:\/\/www\.dankbangkok\.com\/blog\/test-post\/<\/loc><lastmod>2026-10-01<\/lastmod>/);
}));
test('editor posts override and delete seed posts',async()=>{
 const seed=SEED_POSTS[0].slug;
 await writeStore({posts:{[seed]:{...SEED_POSTS[0],title:'Edited title'},'new-one':{...live,slug:'new-one'}},deleted:[]});
 assert.equal(allPosts().find(p=>p.slug===seed).title,'Edited title');
 assert.ok(findPost('new-one'));
 await writeStore({posts:{},deleted:[seed]});
 assert.equal(allPosts().find(p=>p.slug===seed),undefined);
 await writeStore({posts:{},deleted:[]});
 await refreshPosts({force:true});
 assert.ok(publishedPosts().length>=1);
});
test('cleanPost keeps only known fields and rejects bad slugs and dates',()=>{
 const {post,errors}=cleanPost({...live,slug:'Bad Slug',date:'25/10/2026',evil:'<script>'});
 assert.equal(post.evil,undefined);
 assert.equal(errors.length,2);
 assert.equal(cleanPost({...live,draft:undefined}).post.draft,true);
});
test('markdown escapes HTML and refuses javascript: links',()=>{
 const html=markdownToHtml('<script>x</script> [a](javascript:alert(1))');
 assert.ok(!html.includes('<script>'));
 assert.ok(!html.includes('javascript:'));
 assert.equal(markdownToHtml('- a\n- b'),'<ul><li>a</li><li>b</li></ul>');
 assert.equal(markdownToHtml('1. a\n2. b'),'<ol><li>a</li><li>b</li></ol>');
 assert.equal(markdownToHtml('#### Small'),'<h4>Small</h4>');
});
