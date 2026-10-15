const request = require('supertest');
const { DB } = require('../src/database/database.js');
const app = require('../src/service');

function randomName() {
    return Math.random().toString(36).substring(2, 12);
}

async function registerUser() {
    const user = { name: randomName(), email: `${randomName()}@test.com`, password: 'a' };
    const res = await request(app).post('/api/auth').send(user);
    return [res.body.user, res.body.token];
}

test('GET / welcomes you', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('welcome to JWT Pizza');
});

test('GET /api/docs lists the endpoints', async () => {
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.body.endpoints.some((e) => e.path === '/api/user/:userId' && e.method === 'DELETE')).toBe(true);
});

test('unknown endpoints return 404', async () => {
    const res = await request(app).get('/api/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('unknown endpoint');
});

test('logout invalidates the token', async () => {
    const [, token] = await registerUser();
    const logoutRes = await request(app).delete('/api/auth').set('Authorization', 'Bearer ' + token);
    expect(logoutRes.status).toBe(200);

    const meRes = await request(app).get('/api/user/me').set('Authorization', 'Bearer ' + token);
    expect(meRes.status).toBe(401);
});

test('DB.getUsers uses sensible defaults', async () => {
    await registerUser();
    const [users, more] = await DB.getUsers();
    expect(users.length).toBeGreaterThan(0);
    expect(users.length).toBeLessThanOrEqual(10);
    expect(typeof more).toBe('boolean');
});

test('DB.deleteUser rolls back and reports a failure', async () => {
    const [user] = await registerUser();
    const original = DB.query.bind(DB);
    const failing = jest.spyOn(DB, 'query').mockImplementation((connection, sql, params) => {
        if (sql.startsWith('DELETE FROM dinerOrder')) return Promise.reject(new Error('boom'));
        return original(connection, sql, params);
    });
    await expect(DB.deleteUser(user.id)).rejects.toMatchObject({ statusCode: 500 });
    failing.mockRestore();

    const [stillThere] = await DB.getUsers(0, 1000, user.name);
    expect(stillThere.find((u) => u.id === user.id)).toBeDefined();
});

test('GET /api/franchise shows stores to a diner', async () => {
    const [, token] = await registerUser();
    const res = await request(app).get('/api/franchise').set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.franchises)).toBe(true);
});
