// The editor's masks and validators (src/web/ui/masks.ts, validators.ts). They moved out of app.ts unchanged: the cases below are the
// ones the old code answered, so a change in what a field accepts or how it is formatted shows up here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digits, fmtCardExpiry, fmtCardNumber, maskDate, maskDigits, maskPhone } from '../src/web/ui/masks.js';
import { FIELD_VALIDATORS, luhn, validCnpj, validCpf } from '../src/web/ui/validators.js';
import type { Say, ValidatedField } from '../src/web/ui/validators.js';

// A translator that shows the key (and the fixed params), so the tests pin WHICH message a value gets.
const say: Say = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);
const check = (field: ValidatedField, value: string): string => FIELD_VALIDATORS[field](value, say);
const YEAR = 2026;

test('masks: digits and patterns', () => {
  assert.equal(digits(4)('12a34-56'), '1234');
  assert.equal(maskDigits('###.###.###-##')('52998224725'), '529.982.247-25');
  assert.equal(maskDigits('###.###.###-##')('5299'), '529.9');
  assert.equal(maskDigits('###.###.###-##')('529.'), '529');
  assert.equal(maskDigits('#####-###')('01310100999'), '01310-100');
  assert.equal(maskDigits('##.###.###/####-##')(''), '');
});

test('masks: phone, 10-digit landline vs 11-digit mobile', () => {
  assert.equal(maskPhone(''), '');
  assert.equal(maskPhone('1'), '(1');
  assert.equal(maskPhone('12'), '(12');
  assert.equal(maskPhone('123'), '(12) 3');
  assert.equal(maskPhone('1234567891'), '(12) 3456-7891');
  assert.equal(maskPhone('12345678910'), '(12) 34567-8910');
  assert.equal(maskPhone('1234567891011'), '(12) 34567-8910');
});

test('masks: date DD/MM/YYYY is clamped while typing', () => {
  assert.equal(maskDate('', YEAR), '');
  assert.equal(maskDate('4', YEAR), '04');
  assert.equal(maskDate('31022020', YEAR), '31/02/2020');
  assert.equal(maskDate('35', YEAR), '31');
  assert.equal(maskDate('0113', YEAR), '01/12', 'month clamped to 12');
  assert.equal(maskDate('01021', YEAR), '01/02/1');
  assert.equal(maskDate('01029999', YEAR), '01/02/2027', 'year clamped to now + 1');
  assert.equal(maskDate('01020001', YEAR), '01/02/1826', 'year clamped to now - 200');
});

test('masks: card number and expiry', () => {
  assert.equal(fmtCardNumber('4111111111111111'), '4111 1111 1111 1111');
  assert.equal(fmtCardNumber('41111'), '4111 1');
  assert.equal(fmtCardNumber('4111 1111 1111 1111 99'), '4111 1111 1111 1111');
  assert.equal(fmtCardExpiry('', YEAR), '');
  assert.equal(fmtCardExpiry('3', YEAR), '03');
  assert.equal(fmtCardExpiry('132028', YEAR), '12/2028', 'month 13 becomes 12');
  assert.equal(fmtCardExpiry('122020', YEAR), '12/2026', 'a year in the past becomes this year');
  assert.equal(fmtCardExpiry('129999', YEAR), '12/2126', 'at most 100 years ahead');
  assert.equal(fmtCardExpiry('12', YEAR), '12');
  assert.equal(fmtCardExpiry('123', YEAR), '12/3');
});

test('validators: checksums', () => {
  assert.equal(luhn('4111111111111111'), true);
  assert.equal(luhn('4111111111111112'), false);
  assert.equal(validCpf('52998224725'), true);
  assert.equal(validCpf('52998224726'), false);
  assert.equal(validCpf('11111111111'), false, 'repeated digits');
  assert.equal(validCnpj('11222333000181'), true);
  assert.equal(validCnpj('11222333000182'), false);
  assert.equal(validCnpj('00000000000000'), false);
});

test('validators: each field gives the message it always gave', () => {
  const cases: readonly (readonly [ValidatedField, value: string, message: string])[] = [
    ['uris', 'example.com', ''],
    ['uris', 'https://localhost:3000', ''],
    ['uris', '192.168.0.1', ''],
    ['uris', 'a b', 'val.noSpaces'],
    ['uris', 'nodots', 'val.website'],
    ['uris', 'http://', 'val.website'],
    ['cardNumber', '4111 1111 1111 1111', ''],
    ['cardNumber', '4111 1111 1111 1112', 'val.cardInvalid'],
    ['cardNumber', '4111', 'val.cardIncomplete'],
    ['cardExpiry', '12/2030', ''],
    ['cardExpiry', '13/2030', 'val.expiryMonth'],
    ['cardExpiry', '12/20', 'val.expiryIncomplete'],
    ['cardCvv', '123', ''],
    ['cardCvv', '1234', ''],
    ['cardCvv', '12', 'val.cvv'],
    ['email', 'jane@example.com', ''],
    ['email', 'x@y', 'val.email'],
    ['email', 'a b@c.d', 'val.email'],
    ['birthDate', '29/02/2024', ''],
    ['birthDate', '29/02/2023', 'val.dateInvalid'],
    ['birthDate', '31/04/2020', 'val.dateInvalid'],
    ['birthDate', '1/2/2020', 'val.dateIncomplete'],
    ['phone', '(12) 34567-8910', ''],
    ['phone', '(12) 3456-7891', ''],
    ['phone', '(12) 345', 'val.phone'],
    ['cpf', '529.982.247-25', ''],
    ['cpf', '529.982.247-26', 'val.cpfInvalid'],
    ['cpf', '529', 'val.cpfIncomplete'],
    ['cnpj', '11.222.333/0001-81', ''],
    ['cnpj', '11.222.333/0001-82', 'val.cnpjInvalid'],
    ['cnpj', '11', 'val.cnpjIncomplete'],
    ['pis', '123.45678.90-1', ''],
    ['pis', '1', 'val.digits{"label":"field.pis","n":11}'],
    ['cnh', '12345678901', ''],
    ['cnh', '1', 'val.digits{"label":"field.cnh","n":11}'],
    ['zip', '01310-100', ''],
    ['zip', '1', 'val.digits{"label":"field.zip","n":8}'],
    ['sshHost', 'server.example.com', ''],
    ['sshHost', 'bad host', 'val.host'],
    ['sshHost', 'a@b', 'val.host'],
    ['sshHost', 'a/b', 'val.host'],
    ['sshPort', '22', ''],
    ['sshPort', '65535', ''],
    ['sshPort', '0', 'val.port'],
    ['sshPort', '65536', 'val.port'],
    ['sshPort', 'abc', 'val.port'],
  ];
  for (const [field, value, message] of cases) assert.equal(check(field, value), message, `${field}: ${value}`);
});

test('validators: a message never contains what was typed (S3)', () => {
  const typed = 'S3CRET-typed-value-4111';
  for (const field of Object.keys(FIELD_VALIDATORS)) {
    assert.ok(isValidatedField(field));
    assert.equal(check(field, typed).includes(typed), false, field);
  }
});

function isValidatedField(name: string): name is ValidatedField {
  return Object.hasOwn(FIELD_VALIDATORS, name);
}
