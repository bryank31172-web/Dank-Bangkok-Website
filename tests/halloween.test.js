import test from 'node:test';
import assert from 'node:assert/strict';
process.env.ADMIN_SECRET='test-only-secret-long-enough';
const {active,START,END,newToken,valid,prize}=await import('../api/_halloween.js');
test('Bangkok campaign boundaries',()=>{assert.equal(active(START-1),false);assert.equal(active(START),true);assert.equal(active(END-1),true);assert.equal(active(END),false);});
test('tokens reject forgery and malformed input',()=>{const token=newToken();assert.ok(valid(token));assert.equal(valid(token.slice(0,-1)+'!'),false);for(const v of ['',null,{},'a.b'])assert.equal(valid(v),false);});
test('reopening the same link cannot reroll a prize',()=>{const token=newToken();const p=prize(token);for(let i=0;i<100;i++)assert.equal(prize(token),p);assert.ok(['DANK hat','Halloween candy'].includes(p));});
test('missing signing secret fails closed',()=>{const token=newToken();const prev=process.env.ADMIN_SECRET;delete process.env.ADMIN_SECRET;assert.equal(valid(token),false);process.env.ADMIN_SECRET=prev;});
