import {seedAv8} from '../prisma/av8-seed';
it('refuses synthetic production bootstrap before accessing any database',async()=>{
 const before=process.env.AV8_ENV;process.env.AV8_ENV='production';const findFirst=jest.fn();
 try{await expect(seedAv8({admin:{tenant:{findFirst}}}as any)).rejects.toThrow('prohibited in production');expect(findFirst).not.toHaveBeenCalled();}finally{if(before===undefined)delete process.env.AV8_ENV;else process.env.AV8_ENV=before;}
});
