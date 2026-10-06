import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftCalendarDays,shiftCalendarMonth} from '../packages/core/src/calendar.ts';
import {dateRange,subscriptionForRange} from '../packages/core/src/summary.ts';

test('month arrows move May to June and reverse across year boundaries',()=>{
  assert.equal(shiftCalendarMonth('2026-05',1),'2026-06');assert.equal(shiftCalendarMonth('2026-06',-1),'2026-05');
  assert.equal(shiftCalendarMonth('2025-12',1),'2026-01');assert.equal(shiftCalendarMonth('2026-01',-1),'2025-12');
  for(const month of ['1900-01','2199-12'])assert.equal(shiftCalendarMonth(month,month==='1900-01'?-1:1),null);
  assert.equal(shiftCalendarMonth('2026-13',1),null);assert.equal(shiftCalendarMonth('2026-05',.5),null);
});
test('period arrows preserve civil days through leap days and DST changes',()=>{
  assert.equal(shiftCalendarDays('2024-02-28',1),'2024-02-29');assert.equal(shiftCalendarDays('2024-02-29',1),'2024-03-01');
  assert.equal(shiftCalendarDays('2026-03-29',7),'2026-04-05');assert.equal(shiftCalendarDays('2026-04-05',-7),'2026-03-29');
  assert.equal(shiftCalendarDays('2026-10-25',-30),'2026-09-25');assert.equal(shiftCalendarDays('2026-12-31',1),'2027-01-01');
  assert.equal(shiftCalendarDays('2026-02-30',1),null);assert.equal(shiftCalendarDays('private-path',1),null);
});
test('historical 7D and 30D periods retain their preset without a subscription comparison',()=>{
  const now=new Date(2026,9,6,12);
  const seven=dateRange('7d',now,undefined,undefined,undefined,'2026-09-29');assert.equal(seven.calendarFrom,'2026-09-23');assert.equal(seven.calendarTo,'2026-09-29');assert.equal(seven.preset,'7d');assert.equal(subscriptionForRange(200,seven),null);
  const thirty=dateRange('30d',now,undefined,undefined,undefined,'2026-09-30');assert.equal(thirty.calendarFrom,'2026-09-01');assert.equal(thirty.calendarTo,'2026-09-30');assert.equal(subscriptionForRange(200,thirty),null);assert.equal(thirty.label,'2026-09-01 — 2026-09-30');
  const today=dateRange('7d',now,undefined,undefined,undefined,'2026-10-06');assert.equal(today.label,'Last 7 days');
  for(const anchor of ['2026-02-30','2026-10-06junk','0000-01-01',''])assert.throws(()=>dateRange('7d',now,undefined,undefined,undefined,anchor));
  assert.throws(()=>dateRange('month',now,undefined,undefined,'2026-05','2026-05-31'));
});
test('month navigation changes calendar length while preserving the full subscription price',()=>{
  for(const month of ['2024-02','2024-03','2026-05','2026-06']){const r=dateRange('month',new Date(),undefined,undefined,month);assert.equal(subscriptionForRange(200,r),200);assert.equal(r.calendarFrom,month+'-01');}
  const february=dateRange('month',new Date(),undefined,undefined,'2024-02');assert.equal(february.calendarTo,'2024-02-29');
});
