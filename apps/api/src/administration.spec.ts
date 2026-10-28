import { profileInput } from './administration.service';
// Load the actual web formatter through Jest without expanding the API compiler root.
const { minorToDecimal, decimalToMinor } = require('../../web/src/core/access-money');
import { rolePresentation } from './access-presentation';
describe('Account input and exact financial presentation', () => {
    it('allowlists self-service fields and rejects privileged aliases and non-scalar input', () => {
        expect(profileInput({ name: '  Amina  ', phone: '', language: 'ar' }, true)).toEqual({ name: 'Amina', phone: null, language: 'ar' });
        for (const input of [{ roleId: '1' }, { role: { id: '1' } }, { mfaRequired: true }, { homeBranchId: '1' }, { name: { toString: () => 'Admin' } }, { language: 'fr' }])
            expect(() => profileInput(input, true)).toThrow();
    });
    it.each([0, 2, 3, 4, 6])('round-trips exact minor amounts at precision %i', precision => {
        for (const value of ['0', '1', '123456789012345678901234567890'])
            expect(decimalToMinor(minorToDecimal(value, precision), precision)).toBe(value);
    });
    it('rejects lossy amounts and preserves meaningful zero', () => {
        expect(decimalToMinor('0.00', 2)).toBe('0');
        expect(() => decimalToMinor('1.234', 2)).toThrow();
        expect(() => decimalToMinor('1e3', 2)).toThrow();
        expect(() => decimalToMinor('-1', 2)).toThrow();
    });
    it('derives descriptions from grants rather than role names', () => {
        expect(rolePresentation({ name: 'AV8 finance', key: 'av8_finance', permissionKeys: ['av8.leads.view'] }).descriptionLabel.en).toContain('Leads');
        expect(rolePresentation({ name: 'AV8 finance', key: 'av8_finance', permissionKeys: [] }).descriptionLabel.en).toContain('No permissions');
    });
});
