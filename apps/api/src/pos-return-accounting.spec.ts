import { ErpService } from './erp.service';

it('restores the exact original POS cost when quantity-to-unit rounding would introduce a cent',async()=>{
  const erp=Object.create(ErpService.prototype) as any;
  const tx={stockBalance:{findUnique:jest.fn().mockResolvedValue({quantityMilli:1000n,valueMinor:5000n}),upsert:jest.fn().mockResolvedValue({})},stockMovement:{create:jest.fn().mockResolvedValue({})}};
  const result=await erp.stock(tx,{tenantId:1n,userId:2n},{branchId:3n,warehouseId:4n,itemId:5n,qtyMilli:3000n,direction:'IN',unitCostMinor:3334n,exactTotalCostMinor:10001n,date:new Date('2026-10-31'),sourceType:'POS_RETURN',sourceId:6n,sourceNumber:'RETURN-1'});
  expect(result).toEqual({unitCostMinor:3334n,totalCostMinor:10001n,afterQty:4000n,afterValue:15001n});expect(tx.stockMovement.create.mock.calls[0][0].data).toMatchObject({totalCostMinor:10001n,runningValueMinor:15001n});
  await expect(erp.stock(tx,{tenantId:1n,userId:2n},{branchId:3n,warehouseId:4n,itemId:5n,qtyMilli:3000n,direction:'OUT',exactTotalCostMinor:10001n,date:new Date('2026-10-31'),sourceType:'POS_SALE',sourceId:6n,sourceNumber:'SALE-1'})).rejects.toThrow('restricted');
});

function fixture(unavailable=false){
 const erp=Object.create(ErpService.prototype) as any,actor={tenantId:1n,userId:2n},shift={id:7n,branchId:3n,warehouseId:4n,status:'OPEN'};
 const sale={id:6n,status:'COMPLETED',journalEntryId:8n,costMinor:10001n,shiftId:shift.id,shift,lines:[{itemId:5n,quantityMilli:3000n,costMinor:10001n}],tenders:[{method:'CASH',amountMinor:15000n}]};
 const journal={id:8n,number:'J-ORIGINAL',status:'POSTED',currency:'EGP',reversedBy:null,lines:[{accountId:11n,debitMinor:15000n,creditMinor:0n,description:'Cash',account:{code:'1000'}},{accountId:12n,debitMinor:0n,creditMinor:15000n,description:'Revenue',account:{code:'4000'}},{accountId:13n,debitMinor:10001n,creditMinor:0n,description:'COGS',account:{code:'5000'}},{accountId:14n,debitMinor:0n,creditMinor:10001n,description:'Inventory',account:{code:'1200'}}]};
 const resources=new Map([[11n,'HISTORICAL_CASH'],[12n,'4000'],[13n,'5000'],[14n,'1200']]);
 const tx={posSale:{findUnique:jest.fn().mockResolvedValue(sale),findFirst:jest.fn().mockResolvedValue(sale),update:jest.fn().mockResolvedValue({})},posShift:{findUnique:jest.fn().mockResolvedValue(shift),findFirst:jest.fn().mockResolvedValue(shift),update:jest.fn().mockResolvedValue({})},journalEntry:{findFirst:jest.fn().mockResolvedValue(journal)},financialResource:{findFirst:jest.fn().mockImplementation(({where}:any)=>Promise.resolve(unavailable&&where.linkedAccountId===11n?null:{code:resources.get(where.linkedAccountId)}))}};
 Object.assign(erp,{withTenant:jest.fn((_actor:any,work:any)=>work(tx)),requireAtBranch:jest.fn(()=>20n),assertBranch:jest.fn(),assertWarehouse:jest.fn(),posShiftDataScope:jest.fn(()=>({})),companyIdForBranch:jest.fn(()=>20n),sequence:jest.fn().mockResolvedValue('RET-1'),stock:jest.fn().mockResolvedValue({totalCostMinor:10001n}),postedJournal:jest.fn().mockResolvedValue({id:9n,number:'J-REVERSE'}),audit:jest.fn()});
 return {erp,tx,actor};
}
it('reverses original POS monetary accounts through their still-authorized alias instead of a changed current tender mapping',async()=>{
 const {erp,actor,tx}=fixture();await erp.returnPosSale(actor,6n,{reason:'Actual full return'});const input=erp.postedJournal.mock.calls[0][2];expect(input).toMatchObject({reversesEntryId:8n,sourceType:'POS_RETURN',sourceId:6n});expect(input.lines).toEqual(expect.arrayContaining([{code:'HISTORICAL_CASH',debit:0n,credit:15000n,description:expect.any(String)},{code:'1200',debit:10001n,credit:0n,description:expect.any(String)},{code:'5000',debit:0n,credit:10001n,description:expect.any(String)}]));expect(erp.stock.mock.calls[0][2].exactTotalCostMinor).toBe(10001n);expect(tx.posShift.update.mock.calls[0][0].data.expectedCashMinor.decrement).toBe(15000n);
});
it('refuses a return when an original posting account has no approved active company mapping',async()=>{
 const {erp,actor}=fixture(true);await expect(erp.returnPosSale(actor,6n,{reason:'Actual full return'})).rejects.toThrow('historical reconciliation');expect(erp.postedJournal).not.toHaveBeenCalled();expect(erp.stock).not.toHaveBeenCalled();
});
