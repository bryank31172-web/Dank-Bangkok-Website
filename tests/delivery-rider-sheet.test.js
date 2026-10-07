import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('rider sheet collapses after start, drags both ways, clamps height and supports keyboard click',()=>{
 const events={},attrs={},styles={},windowEvents={};let resizes=0;
 const sheet={getBoundingClientRect:()=>({height:300})},handle={addEventListener(e,fn){events[e]=fn},setAttribute(k,v){attrs[k]=v},setPointerCapture(){}};
 const c=vm.createContext({Event:class{},document:{getElementById:id=>id==='sheet'?sheet:handle,documentElement:{style:{setProperty(k,v){styles[k]=v}}}},innerHeight:800,addEventListener(e,fn){windowEvents[e]=fn},dispatchEvent(){resizes++}});c.window=c;
 vm.runInContext(readFileSync(new URL('../rider-sheet.js',import.meta.url),'utf8'),c);const control=vm.runInContext("createRiderSheet('sheet','handle')",c);control.setActive(true);assert.equal(styles['--rider-sheet-height'],'180px');
 events.pointerdown({pointerId:1,clientY:400});events.pointermove({pointerId:1,clientY:100});assert.equal(styles['--rider-sheet-height'],'600px');assert.equal(attrs['aria-expanded'],'true');events.pointerup();events.click();assert.equal(styles['--rider-sheet-height'],'600px');
 events.click();assert.equal(styles['--rider-sheet-height'],'180px');events.click();assert.equal(styles['--rider-sheet-height'],'560px');
 events.pointerdown({pointerId:1,clientY:400});events.pointermove({pointerId:1,clientY:900});assert.equal(styles['--rider-sheet-height'],'180px');events.pointercancel();assert.ok(resizes>=5);
});

