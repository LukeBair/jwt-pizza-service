const request = require('supertest');

const app = require('../src/service');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

function expectValidJwt(potentialJwt) {
    expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

beforeAll(async () => {
    testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
    const registerRes = await request(app).post('/api/auth').send(testUser);
    testUserAuthToken = registerRes.body.token;
    testUser.userID = registerRes.body.user.id;
    expect(registerRes.status).toBe(200);
    expectValidJwt(testUserAuthToken);
});

test('GET /api/user/me returns the authenticated user', async () => {
    const res = await request(app).get('/api/user/me').set('Authorization', `Bearer ${testUserAuthToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: testUser.name, email: testUser.email, roles: [{ role: 'diner' }] });
});

test('PUT /api/user/:userId updates the authenticated user', async () => {
    const res = await request(app)
        .put(`/api/user/${testUser.userID}`)
        .set('Authorization', `Bearer ${testUserAuthToken}`)
        .send({ name: 'Updated Name', email: testUser.email, password: testUser.password});
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'Updated Name', email: testUser.email, roles: [{ role: 'diner' }] });
    expectValidJwt(res.body.token);
});

test('PUT /api/user/:userId returns 403 for a different diner', async () => {
    const res = await request(app)
        .put(`/api/user/${testUser.userID + 1}`)
        .set('Authorization', `Bearer ${testUserAuthToken}`)
        .send({ name: 'Hacker Name', email: 'hacker@test.com' });
    expect(res.status).toBe(403);
});

test('DELETE /api/user/:userId is not implemented', async () => {
    const res = await request(app)
        .delete(`/api/user/${testUser.userID}`)
        .set('Authorization', `Bearer ${testUserAuthToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('not implemented');
});

test('GET /api/user is not implemented', async () => {
    const res = await request(app).get('/api/user').set('Authorization', `Bearer ${testUserAuthToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('not implemented');
});

test('user routes return 401 without a token', async () => {
    const res = await request(app).get('/api/user/me');
    expect(res.status).toBe(401);
});

test('list users unauthorized', async () => {
    const listUsersRes = await request(app).get('/api/user');
    expect(listUsersRes.status).toBe(401);
});

test('list users', async () => {
    const [user, userToken] = await registerUser(request(app));
    const listUsersRes = await request(app)
        .get('/api/user')
        .set('Authorization', 'Bearer ' + userToken);
    expect(listUsersRes.status).toBe(200);
});

async function registerUser(service) {
    const testUser = {
        name: 'pizza diner',
        email: `${randomName()}@test.com`,
        password: 'a',
    };
    const registerRes = await service.post('/api/auth').send(testUser);
    registerRes.body.user.password = testUser.password;

    return [registerRes.body.user, registerRes.body.token];
}

function randomName() {
    return Math.random().toString(36).substring(2, 12);
}