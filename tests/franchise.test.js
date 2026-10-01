const request = require('supertest');
const { Role, DB } = require('../src/database/database.js');

const app = require('../src/service');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;
let adminAuthToken;

function expectValidJwt(potentialJwt) {
    expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

async function createFranchise() {
    const franchiseName = 'Test Franchise ' + Math.random().toString(36).substring(2, 12);
    return await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send({name: franchiseName, admins: [{email: testUser.email}]});
}

async function deleteFranchise(franchiseID) {
    return await request(app).delete(`/api/franchise/${franchiseID}`).set('Authorization', `Bearer ${adminAuthToken}`);
}

async function createAdminUser() {
    let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
    user.name = Math.random().toString(36).substring(2, 12);
    user.email = user.name + '@admin.com';
    user = await DB.addUser(user);
    return { ...user, password: 'toomanysecrets' };
}

beforeAll(async () => {
    testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
    const registerRes = await request(app).post('/api/auth').send(testUser);
    testUserAuthToken = registerRes.body.token;
    testUser.userID = registerRes.body.user.id;
    expect(registerRes.status).toBe(200);
    expectValidJwt(testUserAuthToken);

    const adminUser = await createAdminUser();
    const loginRes = await request(app).put('/api/auth').send(adminUser);
    adminAuthToken = loginRes.body.token;
    expect(loginRes.status).toBe(200);
    expectValidJwt(adminAuthToken);
});

test('GET /api/franchise lists franchises', async () => {
    const res = await request(app).get('/api/franchise').set('Authorization', `Bearer ${adminAuthToken}`);
    expect(res.status).toBe(200);
});

test('GET /api/franchise/:userId returns that user franchises', async () => {
    const res = await request(app).get(`/api/franchise/${testUser.userID}`).set('Authorization', `Bearer ${adminAuthToken}`);
    expect(res.status).toBe(200);
});

test('GET /api/franchise/:userId returns an empty list for another diner', async () => {
    const res = await request(app).get(`/api/franchise/${testUser.userID + 1}`).set('Authorization', `Bearer ${testUserAuthToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
});

test('POST /api/franchise creates a franchise for an admin', async () => {
    const res = await createFranchise();
    expect(res.status).toBe(200);
    const franchiseID = res.body.id;
    await deleteFranchise(franchiseID);
});

test('POST /api/franchise returns 403 for a diner', async () => {
    const res = await request(app).post('/api/franchise').set('Authorization', `Bearer ${testUserAuthToken}`).send({ name: 'Test Franchise' });
    expect(res.status).toBe(403);
});

test('DELETE /api/franchise/:franchiseId deletes a franchise', async () => {
    const franchise = await createFranchise();
    const franchiseID = franchise.body.id;
    const res = await deleteFranchise(franchiseID);
    expect(res.status).toBe(200);
});

test('POST /api/franchise/:franchiseId/store creates a store', async () => {
    const franchise = await createFranchise();
    const franchiseID = franchise.body.id;

    const res = await request(app)
        .post(`/api/franchise/${franchiseID}/store`)
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send({ name: 'Test Store' });
    expect(res.status).toBe(200);
});

test('POST /api/franchise/:franchiseId/store returns 403 for an unrelated diner', async () => {
    const franchise = await createFranchise();
    const franchiseID = franchise.body.id;
    const otherDiner = { name: 'other diner', email: Math.random().toString(36).substring(2, 12) + '@test.com', password: 'a' };
    const registerRes = await request(app).post('/api/auth').send(otherDiner);
    const token = registerRes.body.token;

    const res = await request(app).post(`/api/franchise/${franchiseID}/store`).set('Authorization', `Bearer ${token}`).send({ name: 'Test Store' });
    expect(res.status).toBe(403);
});

test('DELETE /api/franchise/:franchiseId/store/:storeId deletes a store', async () => {
    const franchise = await createFranchise();
    const franchiseID = franchise.body.id;
    const store = await request(app)
        .post(`/api/franchise/${franchiseID}/store`)
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send({ name: 'Test Store' });


    const res = await request(app).delete(`/api/franchise/${franchiseID}/store/${store.body.id}`).set('Authorization', `Bearer ${adminAuthToken}`);
    expect(res.status).toBe(200);
});
