const logger = require('../src/logger.js');

test('sanitize masks confidential fields', () => {
  const out = JSON.parse(logger.sanitize({ email: 'a@b.com', password: 'secret', nested: { token: 'abc', jwt: 'x.y.z' }, list: [{ apiKey: 'k' }] }));
  expect(out.email).toBe('a@b.com');
  expect(out.password).toBe('*****');
  expect(out.nested.token).toBe('*****');
  expect(out.nested.jwt).toBe('*****');
  expect(out.list[0].apiKey).toBe('*****');
});

test('sanitize scrubs bearer tokens and JWTs inside strings', () => {
  const out = logger.sanitize('auth Bearer abc123 and eyJhbGc.eyJzdWI.sig');
  expect(out).not.toContain('abc123');
  expect(out).not.toContain('eyJhbGc');
});

test('sanitize parses JSON strings', () => {
  expect(JSON.parse(logger.sanitize('{"password":"p","a":1}'))).toEqual({ password: '*****', a: 1 });
});

test('statusToLogLevel', () => {
  expect(logger.statusToLogLevel(200)).toBe('info');
  expect(logger.statusToLogLevel(404)).toBe('warn');
  expect(logger.statusToLogLevel(500)).toBe('error');
});

test('does not send logs during tests', () => {
  const spy = jest.spyOn(global, 'fetch');
  logger.log('info', 'test', { a: 1 });
  logger.factoryLogger({ statusCode: 500 });
  logger.unhandledErrorLogger(new Error('boom'));
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
