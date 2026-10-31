import {contactKeys,normalizedPhone,normalizedName} from './contact-normalization';
import {leadInput} from './av8-domain';
describe('search identity review keys',()=>{
 it('accepts Arabic/Persian digits without rewriting original contact evidence',()=>{const phone='+٢٠ (١٢) ٣٤٥٦٧٨٩٠';expect(leadInput({name:'أحمد',phone,source:'QA'}).phone).toBe(phone);expect(normalizedPhone(phone)).toBe('201234567890');expect(normalizedPhone('۰۰۲۰۱۲۳۴۵۶۷۸۹۰')).toBe('201234567890');});
 it('matches diacritics/alef variants and email case while retaining distinct local phone semantics',()=>{expect(normalizedName('  أَحْمَد   عليـى ')).toBe(normalizedName('احمد عليي'));expect(contactKeys({name:'Person',phone:'12345',email:'USER@example.test'}).normalizedEmail).toBe('user@example.test');expect(normalizedPhone('012345')).not.toBe(normalizedPhone('+2012345'));});
});
