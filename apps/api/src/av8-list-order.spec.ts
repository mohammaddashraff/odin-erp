import {av8DatabaseOrder,orderAv8Rows} from './av8-list-order';
describe('AV8 full-dataset presentation ordering',()=>{
 test('sorts exact large minor units before slicing, nulls last in both directions',()=>{
   const rows=Array.from({length:31},(_,i)=>({id:String(i+1),amountMinor:String(900719925474099300n+BigInt(30-i))}));
   const result=orderAv8Rows([...rows,{id:'missing',amountMinor:null} as any],{sort:'amountMinor'});
   expect(result.slice(0,25)[0].id).toBe('31');expect(result[24].id).toBe('7');expect(result.at(-1)?.id).toBe('missing');
   expect(orderAv8Rows(result,{sort:'amountMinor',direction:'desc'}).at(-1)?.id).toBe('missing');
 });
 test('keeps stable ties and ignores unknown ordering keys',()=>{
   const rows=[{id:'2',name:'Same'},{id:'1',name:'Same'}];
   expect(orderAv8Rows(rows,{sort:'name'}).map(x=>x.id)).toEqual(['1','2']);
   expect(orderAv8Rows(rows,{sort:'privateField'})).toBe(rows);
 });
 test('database ordering uses allowlisted columns, nullable dates and stable ID',()=>{
   expect(av8DatabaseOrder('leads',{sort:'firstContactAt',direction:'desc'})).toEqual([{firstContactAt:{sort:'desc',nulls:'last'}},{id:'asc'}]);
   expect(av8DatabaseOrder('applications',{sort:'name'})).toEqual([{customer:{name:'asc'}},{id:'asc'}]);
   expect(av8DatabaseOrder('leads',{sort:'ownerPassword'})).toEqual([{inquiryAt:'desc'},{id:'desc'}]);
 });
});
