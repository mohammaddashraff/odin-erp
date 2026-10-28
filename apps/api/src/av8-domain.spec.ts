import { monthsAfter,planPreview,splitMinor,calendarDate,csvRows,missingDocuments,transition } from './av8-domain';
import { assertAv8Isolation } from './av8-isolation';
describe('AV8 exact commercial rules',()=>{
 const rules={interpretation:'EACH',anchor:'DEPARTURE',offsetMonths:3,frequencyMonths:3,firstMilestone:'CONTRACT'};
 it('keeps both unconfirmed readings explicit and exact',()=>{
  expect(planPreview('A',rules).totalMinor).toBe('6400000');expect(planPreview('B',rules).totalMinor).toBe('6400000');
  expect(planPreview('A',{...rules,interpretation:'TOTAL'}).totalMinor).toBe('2560000');
  const b=planPreview('B',{...rules,interpretation:'TOTAL'});expect(b.totalMinor).toBe('2400000');expect(b.items.filter(x=>x.deferred).map(x=>x.amountMinor)).toEqual(['133334','133334','133333','133333','133333','133333']);
  expect(planPreview('CASH',{}).totalMinor).toBe('5400000');expect(splitMinor(800000n,6).reduce((s,n)=>s+n,0n)).toBe(800000n);
 });
 it('blocks missing live rules but never blocks confirmed cash pricing',()=>{expect(()=>planPreview('A',{interpretation:'EACH'},undefined,true)).toThrow('anchor');expect(()=>planPreview('B',{...rules,firstMilestone:null},undefined,true)).toThrow('milestone');expect(()=>planPreview('CASH',{},undefined,true)).not.toThrow();});
 it('uses calendar months and original anchor day, including leap years',()=>{expect(monthsAfter('2024-01-31',1)).toBe('2024-02-29');expect(monthsAfter('2025-01-31',3)).toBe('2025-04-30');expect(monthsAfter('2025-01-31',6)).toBe('2025-07-31');const items=planPreview('A',rules,'2025-01-31',true).items.filter(x=>x.deferred);expect(items[0].dueDate).toBe('2025-04-30');expect(items[1].dueDate).toBe('2025-07-31');expect(()=>calendarDate('2025-02-30')).toThrow();});
 it('allows conditional family documents without inventing expiry rules',()=>{expect(missingDocuments([{kind:'document',key:'family',status:'NOT_APPLICABLE',data:{mandatory:false,reason:'Not requested'}}])).toEqual([]);expect(missingDocuments([{kind:'document',key:'passport',status:'ACCEPTED',data:{mandatory:true,expiry:'2020-01-01'}}])).toEqual(['passport']);});
 it('parses quoted CSV and rejects malformed rows/unsafe runtime',()=>{expect(csvRows('name,phone,source\n"Test, Student",+20100000000,Social\n')).toHaveLength(2);expect(()=>csvRows('"unclosed')).toThrow();expect(()=>assertAv8Isolation({})).toThrow('isolated');});
 it('requires explicit transitions, with independent visa and English tracks',()=>{expect(()=>transition('visa','SUBMITTED','ISSUED')).not.toThrow();expect(()=>transition('english','ASSESSMENT_PENDING','COMPLETED')).toThrow();expect(()=>transition('travel','PREPARING','ARRIVAL_CONFIRMED')).toThrow();});
});
