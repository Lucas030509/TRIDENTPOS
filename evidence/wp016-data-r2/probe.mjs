import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {EdgeDatabaseService, EdgeOutboxPersistence, LocalAuditTrailPersistence} from './runtime/packages/edge/dist/index.js';
import {SqliteCashShiftRepository,createPosFastifyApp} from './runtime/packages/pos-edge-runtime/dist/index.js';
const [mode,dbPath,stage]=process.argv.slice(2);
const now=new Date().toISOString();
const seed={id:'shift',organizationId:'org',branchId:'branch',stationId:'station',responsibleUserId:'operator',openedByUserId:'operator',shiftNumber:1,openingCashFloat:1000000n,closingDeclaredCash:900000n,calculatedCashTotal:1000000n,cashDifference:-100000n,status:'CERRADO_ARQUEO',assignmentStrategy:'COMPARTIDO',participatingOperators:['operator'],openedAt:now,closedAt:null,version:2,updatedAt:now};
const corte={id:'corte',turnoCajaId:'shift',tipoCorte:'CORTE_Z',generatedByUserId:'operator',openingCashFloat:1000000n,totalIngresos:0n,totalEgresos:0n,totalVentasEfectivo:0n,totalCalculado:1000000n,totalDeclarado:900000n,diferencia:-100000n,desgloseOperadores:[],generatedAt:now};
if(mode==='child'){
 const db=new EdgeDatabaseService({databasePath:dbPath});const repo=new SqliteCashShiftRepository(db);repo.saveShiftSync(seed,0);
 const kill=()=>process.kill(process.pid,'SIGKILL');
 const mutate=db.executeMutation.bind(db);db.executeMutation=(sql,...args)=>{const r=mutate(sql,...args);if((stage==='shift'&&/UPDATE turnos_caja/.test(sql))||(stage==='corte'&&/INSERT INTO cortes_caja/.test(sql)))kill();return r;};
 for(const [cls,method,point] of [[LocalAuditTrailPersistence,'recordAudit','audit'],[EdgeOutboxPersistence,'enqueue','outbox']]){const old=cls.prototype[method];cls.prototype[method]=function(...args){const r=old.apply(this,args);if(stage===point)kill();return r;};}
 repo.saveCorteZSync(corte,{...seed,status:'CORTE_Z_EMITIDO',closedAt:now,version:3},2);kill();
}else{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wp016-r2-independent-'));
 try{
  const db=new EdgeDatabaseService({databasePath:path.join(root,'concurrency.db')});const outbox=new EdgeOutboxPersistence(db);const app=await createPosFastifyApp({edgeDb:db,outbox,organizationId:'org',branchId:'branch',stationId:'station'});
  const open=()=>app.inject({method:'POST',url:'/turnos/apertura',payload:{responsibleUserId:'operator',openingCashFloat:'100.0000'}});
  const opened=await Promise.all([open(),open()]);assert.deepEqual(opened.map(r=>r.statusCode).sort(),[201,409]);assert.equal(opened.find(r=>r.statusCode===409).json().error,'SHIFT_ALREADY_OPEN');
  const id=opened.find(r=>r.statusCode===201).json().turno.id;
  assert.equal(db.queryRowsSafe("SELECT * FROM turnos_caja WHERE status='ABIERTO'").length,1);
  console.log('PASS concurrent HTTP openings:',opened.map(r=>r.statusCode));
  const current=new SqliteCashShiftRepository(db).getShiftByIdSync(id);
  const arq=await app.inject({method:'POST',url:`/turnos/${id}/arqueo`,payload:{performedByUserId:'operator',declaredCash:'90.0000',expectedVersion:current.version}});
  assert.equal(arq.statusCode,200);
  const version=new SqliteCashShiftRepository(db).getShiftByIdSync(id).version;
  const close=()=>app.inject({method:'POST',url:`/turnos/${id}/corte-z`,payload:{closedByUserId:'operator',expectedVersion:version}});
  const closed=await Promise.all([close(),close()]);assert.deepEqual(closed.map(r=>r.statusCode).sort(),[200,409]);assert.equal(closed.find(r=>r.statusCode===409).json().error,'OCC_CONFLICT');
  assert.equal(db.queryRowsSafe("SELECT * FROM cortes_caja WHERE tipo_corte='CORTE_Z'").length,1);assert.equal(db.queryRowsSafe("SELECT * FROM outbox_queue WHERE action='CorteZGenerado'").length,1);
  console.log('PASS concurrent HTTP closes:',closed.map(r=>r.statusCode),'one corte, one event');await app.close();db.close();
  for(const point of ['shift','corte','audit','outbox','committed']){
   const file=path.join(root,point+'.db');const result=spawnSync(process.execPath,[import.meta.filename,'child',file,point],{encoding:'utf8'});assert.equal(result.signal,'SIGKILL',result.stderr);
   const recovered=new EdgeDatabaseService({databasePath:file});const repo=new SqliteCashShiftRepository(recovered);const shift=repo.getShiftByIdSync('shift');const counts=['cortes_caja','local_audit_trail','outbox_queue'].map(t=>recovered.queryRowsSafe('SELECT * FROM '+t).length);
   assert.equal(shift.version,point==='committed'?3:2);assert.equal(shift.status,point==='committed'?'CORTE_Z_EMITIDO':'CERRADO_ARQUEO');assert.deepEqual(counts,point==='committed'?[1,1,1]:[0,0,0]);console.log('PASS SIGKILL/reopen',point,JSON.stringify({version:shift.version,counts}));recovered.close();
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
