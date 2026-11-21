import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/backoffice/auth.js';
import { staffIdentity } from '../api/_auth.js';

function request(body,token=''){
  return new Promise(resolve=>{
    const req={method:'POST',url:'/api/backoffice/auth',body,headers:{authorization:token?`Bearer ${token}`:''}};
    const res={setHeader(){},status(code){this.code=code;return this;},json(data){resolve({code:this.code,data});}};
    handler(req,res);
  });
}

test('BackOffice password grants only a BackOffice session',async()=>{
  const previous=process.env.BACKOFFICE_PASSWORD;
  const previousAdmin=process.env.ADMIN_SECRET;
  process.env.BACKOFFICE_PASSWORD='local-test-password';
  process.env.ADMIN_SECRET='test-admin-secret';
  try{
    assert.equal((await request({action:'login',password:'wrong'})).code,401);
    const login=await request({action:'login',password:'local-test-password'});
    assert.equal(login.code,200);
    assert.equal((await request({action:'verify'},login.data.token)).code,200);
    assert.equal(staffIdentity({url:'/api/backoffice/stores',headers:{authorization:`Bearer ${login.data.token}`}})?.role,'backoffice');
    assert.equal(staffIdentity({url:'/api/staff-auth',headers:{authorization:`Bearer ${login.data.token}`}}),null);
    process.env.BACKOFFICE_PASSWORD='changed-password';
    assert.equal((await request({action:'verify'},login.data.token)).code,401);
  }finally{
    if(previous===undefined) delete process.env.BACKOFFICE_PASSWORD;
    else process.env.BACKOFFICE_PASSWORD=previous;
    if(previousAdmin===undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET=previousAdmin;
  }
});
