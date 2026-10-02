import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
export async function createPool() {
 const db = await PGlite.create({ extensions: {pgcrypto} });
 return {
  async query(sql, params) {
   if (!params?.length) {
    const results = await db.exec(sql);
    const result=results.at(-1) ?? {rows:[],affectedRows:0};
    return {...result,rowCount:result.affectedRows ?? result.rows.length};
   }
   const result=await db.query(sql,params);
   return {...result,rowCount:result.affectedRows ?? result.rows.length};
  },
  async connect(){return {...this,release(){}};},
  async end(){await db.close();}
 };
}
