const request = require('supertest');

const { Role, DB } = require('../src/database/database.js');
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

test('user routes return 401 without a token', async () => {
    const res = await request(app).get('/api/user/me');
    expect(res.status).toBe(401);
});

test('list users unauthorized', async () => {
    const listUsersRes = await request(app).get('/api/user');
    expect(listUsersRes.status).toBe(401);
});

test('list users forbidden for a diner', async () => {
    const [, userToken] = await registerUser(request(app));
    const listUsersRes = await request(app)
        .get('/api/user')
        .set('Authorization', 'Bearer ' + userToken);
    expect(listUsersRes.status).toBe(403);
});

test('list users as admin returns users without passwords', async () => {
    const [user] = await registerUser(request(app));
    const [adminToken] = await loginAdmin();
    const listUsersRes = await request(app)
        .get(`/api/user?page=0&limit=1000&name=${user.name}*`)
        .set('Authorization', 'Bearer ' + adminToken);
    expect(listUsersRes.status).toBe(200);
    expect(typeof listUsersRes.body.more).toBe('boolean');
    const found = listUsersRes.body.users.find((u) => u.id === user.id);
    expect(found).toMatchObject({ id: user.id, name: user.name, email: user.email, roles: [{ role: 'diner' }] });
    expect(found.password).toBeUndefined();
});

test('list users paginates', async () => {
    const [adminToken] = await loginAdmin();
    await registerUser(request(app));
    await registerUser(request(app));

    const page0 = await request(app).get('/api/user?page=0&limit=1').set('Authorization', 'Bearer ' + adminToken);
    expect(page0.status).toBe(200);
    expect(page0.body.users).toHaveLength(1);
    expect(page0.body.more).toBe(true);

    const page1 = await request(app).get('/api/user?page=1&limit=1').set('Authorization', 'Bearer ' + adminToken);
    expect(page1.body.users).toHaveLength(1);
    expect(page1.body.users[0].id).not.toBe(page0.body.users[0].id);
});

test('list users filters by name', async () => {
    const [adminToken] = await loginAdmin();
    const unique = randomName();
    const [match] = await registerUser(request(app), `${unique} diner`);
    await registerUser(request(app));

    const res = await request(app).get(`/api/user?page=0&limit=10&name=${unique}*`).set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.id)).toEqual([match.id]);
    expect(res.body.more).toBe(false);
});

test('list users defaults to the first page of all users', async () => {
    const [adminToken] = await loginAdmin();
    const res = await request(app).get('/api/user').set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThan(0);
});

test('delete user unauthorized', async () => {
    const deleteRes = await request(app).delete(`/api/user/${testUser.userID}`);
    expect(deleteRes.status).toBe(401);
});

test('delete user forbidden for a diner', async () => {
    const [victim] = await registerUser(request(app));
    const [, otherToken] = await registerUser(request(app));
    const deleteRes = await request(app)
        .delete(`/api/user/${victim.id}`)
        .set('Authorization', 'Bearer ' + otherToken);
    expect(deleteRes.status).toBe(403);
});

test('delete user as admin removes the user', async () => {
    const [victim, victimToken] = await registerUser(request(app));
    const [adminToken] = await loginAdmin();

    const deleteRes = await request(app)
        .delete(`/api/user/${victim.id}`)
        .set('Authorization', 'Bearer ' + adminToken);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.message).toBe('user deleted');

    const loginRes = await request(app).put('/api/auth').send({ email: victim.email, password: victim.password });
    expect(loginRes.status).toBe(404);

    const meRes = await request(app).get('/api/user/me').set('Authorization', 'Bearer ' + victimToken);
    expect(meRes.status).toBe(401);

    const listRes = await request(app)
        .get(`/api/user?page=0&limit=1000&name=*`)
        .set('Authorization', 'Bearer ' + adminToken);
    expect(listRes.body.users.find((u) => u.id === victim.id)).toBeUndefined();
});

test('delete user removes their order history', async () => {
    const [victim] = await registerUser(request(app));
    const [adminToken] = await loginAdmin();
    await DB.addDinerOrder(victim, { franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] });

    const deleteRes = await request(app)
        .delete(`/api/user/${victim.id}`)
        .set('Authorization', 'Bearer ' + adminToken);
    expect(deleteRes.status).toBe(200);

    const orders = await DB.getOrders({ id: victim.id });
    expect(orders.orders).toHaveLength(0);
});

test('delete user that does not exist returns 404', async () => {
    const [adminToken] = await loginAdmin();
    const deleteRes = await request(app)
        .delete('/api/user/99999999')
        .set('Authorization', 'Bearer ' + adminToken);
    expect(deleteRes.status).toBe(404);
});

async function loginAdmin() {
    const admin = { name: randomName(), password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
    admin.email = admin.name + '@admin.com';
    await DB.addUser(admin);
    const loginRes = await request(app).put('/api/auth').send({ email: admin.email, password: admin.password });
    return [loginRes.body.token, loginRes.body.user];
}

async function registerUser(service, name = 'pizza diner') {
    const testUser = {
        name,
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