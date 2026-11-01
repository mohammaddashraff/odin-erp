import {createFirstOwner,firstOwnerConfiguration} from './av8-first-owner';

describe('Empty installation named owner bootstrap',()=>{
  const env={AV8_HOSTING:'hetzner',AV8_ENV:'production',AV8_INITIAL_SETUP:'EMPTY_DATABASE_ONLY',AV8_INITIAL_ADMIN_EMAIL:'named-owner@example.invalid',AV8_INITIAL_ADMIN_NAME:'Named owner',AV8_INITIAL_COMPANY_NAME:'Reviewed company',AV8_INITIAL_BRANCH_NAME:'Approved branch',AV8_INITIAL_BRANCH_CODE:'CAI'};
  it('requires explicit identity and cannot invoke demo or reset behavior',()=>{
    expect(firstOwnerConfiguration(env).email).toBe('named-owner@example.invalid');
    for(const value of [{...env,AV8_ENV:'test'},{...env,AV8_INITIAL_SETUP:''},{...env,AV8_INITIAL_ADMIN_EMAIL:''},{...env,AV8_INITIAL_COMPANY_NAME:''},{...env,AV8_INITIAL_BRANCH_CODE:'invalid code'}])expect(()=>firstOwnerConfiguration(value)).toThrow();
  });
  it('refuses existing tenants before any mutation',async()=>{
    const create=jest.fn(),tx={$executeRaw:jest.fn(),tenant:{count:jest.fn().mockResolvedValue(1),create},user:{count:jest.fn()}};
    await expect(createFirstOwner({admin:{$transaction:(work:any)=>work(tx)}}as any,firstOwnerConfiguration(env),'x'.repeat(48))).rejects.toThrow('existing installation');expect(create).not.toHaveBeenCalled();
  });
  it('creates only a named MFA owner and draft reference policies with no financial data',async()=>{
    const created:any[]=[];let id=0n;const model=(name:string)=>({count:jest.fn().mockResolvedValue(0),create:jest.fn(async({data}:any)=>{created.push({model:name,data});return{id:++id,...data};}),findFirstOrThrow:jest.fn().mockResolvedValue({id:2n}),update:jest.fn()});
    const tx:any={$executeRaw:jest.fn()};for(const name of ['tenant','company','user','branch','permission','role','rolePermission','currency','av8Policy','auditEvent'])tx[name]=model(name);
    await createFirstOwner({admin:{$transaction:(work:any)=>work(tx)}}as any,firstOwnerConfiguration(env),'x'.repeat(48));
    const owner=created.find(r=>r.model==='user').data;expect(owner).toMatchObject({email:env.AV8_INITIAL_ADMIN_EMAIL,mfaRequired:true,passwordChangeRequired:true});expect(owner.passwordHash).not.toContain('x'.repeat(48));expect(owner.temporaryPasswordExpiresAt).toBeInstanceOf(Date);
    expect(created.filter(r=>r.model==='av8Policy').every(r=>r.data.status==='DRAFT')).toBe(true);expect(created.some(r=>['customer','supplier','bankTransaction','journalEntry','av8Application'].includes(r.model))).toBe(false);
  });
});
