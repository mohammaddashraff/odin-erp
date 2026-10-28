import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatDate,formatDateTime} from '../../apps/web/src/core/formatters';
import {cairoDateTime,cairoInstant} from '../../apps/web/src/core/cairo-time';

test('financial calendar dates agree with input in western and eastern browser zones',()=>{
  const original=process.env.TZ;
  try{for(const timezone of ['America/Los_Angeles','Asia/Tokyo','Africa/Cairo']){
    process.env.TZ=timezone;
    assert.equal(formatDate('2026-10-24','en',{dateFormat:'short'}),'10/24/26');
    assert.equal(formatDate('2026-10-24T00:00:00.000Z','en',{dateFormat:'short'}),'10/24/26');
    assert.equal(formatDate('2026-01-01T00:00:00.000Z','en',{dateFormat:'short'}),'1/1/26');
    assert.match(formatDateTime('2026-10-24T22:30:00Z','en'),/Oct 25/);
  }}finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});

test('Cairo calendar controls handle summer, winter, year-away follow-ups and invalid DST times',()=>{
  assert.equal(cairoInstant('2026-10-25T13:00'),'2026-10-25T10:00:00.000Z');
  assert.equal(cairoInstant('2026-01-15T13:00'),'2026-01-15T11:00:00.000Z');
  assert.equal(cairoDateTime('2026-10-24T22:30:00Z'),'2026-10-25T01:30');
  assert.equal(cairoDateTime(cairoInstant('2027-10-25T13:00')),'2027-10-25T13:00');
  assert.throws(()=>cairoInstant('2026-04-24T00:30'),/does not exist/);
  assert.throws(()=>cairoInstant('2026-02-30T10:00'));
});
