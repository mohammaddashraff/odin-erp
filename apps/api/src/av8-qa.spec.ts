import {av8Csv} from './av8-export';
import {csvRows,cairoCalendarDate} from './av8-domain';

describe('AV8 reported date and export regressions',()=>{
  it('uses Cairo calendar dates at the UTC midnight boundary',()=>{
    expect(cairoCalendarDate(new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
  });
  it('exports exact major units, explicit currencies and Arabic column labels',()=>{
    const result=csvRows(av8Csv({currency:'USD',rows:[{reference:'AV8-1',totalMinor:'200000',paidMinor:'50000',remainingMinor:'150000',refundedMinor:'10000'}]},'ar').replace(/^\uFEFF/,''));
    expect(result[0]).toEqual(['المرجع','إجمالي الرسوم','المسدد','المتبقي','المسترد','العملة']);
    expect(result[1]).toEqual(['AV8-1','2000.00','500.00','1500.00','100.00','USD']);
  });
  it('keeps original currency distinct from USD and prevents spreadsheet formula injection',()=>{
    const result=csvRows(av8Csv({rows:[{name:'=HYPERLINK("bad")',amountMinor:'9007199254740993',currency:'EGP',usdMinor:'12345'}]},'en').replace(/^\uFEFF/,''));
    expect(result[1]).toEqual(['\'=HYPERLINK("bad")','90071992547409.93','EGP','123.45','USD']);
  });
});
