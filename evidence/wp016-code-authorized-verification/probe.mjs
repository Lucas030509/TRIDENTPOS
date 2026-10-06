import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EdgeDatabaseService,EdgeOutboxPersistence} from './runtime/packages/edge/dist/index.js';
import {CashShiftDomainService} from './runtime/packages/pos/dist/index.js';
import {createPosFastifyApp,SqliteCashShiftRepository} from './runtime/packages/pos-edge-runtime/dist/index.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wp016-pin-check-'));const db=new EdgeDatabaseService({databasePath:path.join(dir,'edge.db')});
try{
 const repo=new SqliteCashShiftRepository(db);
 for(const validator of [undefined,null])assert.throws(()=>new CashShiftDomainService({repository:repo,pinValidator:validator}),e=>e.code==='PIN_VALIDATOR_REQUIRED');
 console.log('PASS constructor rejects missing/null pinValidator');
 const outbox=new EdgeOutboxPersistence(db);const options={edgeDb:db,outbox,organizationId:'org',branchId:'branch',stationId:'station'};
 const unconfigured=await createPosFastifyApp(options);
 for(const route of ['/turnos/apertura','/turnos/id/operadores','/turnos/id/movimientos','/turnos/id/corte-x','/turnos/id/arqueo','/turnos/id/corte-z']){const r=await unconfigured.inject({method:'POST',url:route,payload:{}});assert.equal(r.statusCode,500);assert.equal(r.json().error,'PIN_VALIDATOR_REQUIRED');}
 await unconfigured.close();console.log('PASS all six routes reject unconfigured service');
 const calls=[];const iam={authenticateWithPin:async input=>{calls.push(input);return input.pin==='1234'?{success:true,session:{userId:input.userId}}:{success:false};}};
 const app=await createPosFastifyApp({...options,offlineIamService:iam});
 const opened=await app.inject({method:'POST',url:'/turnos/apertura',payload:{responsibleUserId:'operator',operatorPin:'1234',openingCashFloat:'0.0000'}});assert.equal(opened.statusCode,201);const shift=opened.json().turno;
 for(const pin of [undefined,'','INVALID']){const r=await app.inject({method:'POST',url:`/turnos/${shift.id}/movimientos`,payload:{operatorUserId:'operator',operatorPin:pin,movementType:'VENTA_EFECTIVO',amount:'1.0000',reason:'probe',expectedVersion:shift.version}});assert.equal(r.statusCode,401);assert.equal(r.json().error,'INVALID_OPERATOR_PIN');}
 assert.equal(db.queryRowsSafe('SELECT * FROM movimientos_caja').length,0);assert.equal(calls.length,2);assert.deepEqual(calls.map(x=>x.stationId),['station','station']);
 console.log('PASS real adapter wiring delegates IAM; missing/empty/invalid PIN -> 401, zero movements');await app.close();
}finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
