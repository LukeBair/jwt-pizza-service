const request = require('supertest');
const { Role, DB } = require('../src/database/database.js');

const app = require('../src/service');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;
let adminAuthToken;

function expectValidJwt(potentialJwt) {
    expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
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

test('GET /api/order/menu returns the menu', async () => {
    const res = await request(app).get('/api/order/menu').set('Authorization', `Bearer ${testUserAuthToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
})

test('PUT /api/order/menu adds an item for an admin', async () => {
    const newItem = { title: 'Test Pizza', description: 'A test pizza', image: 'pizza1.png', price: 0.99 };    const res = await request(app)
        .put('/api/order/menu')
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send(newItem);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining(newItem)]));
});

test('PUT /api/order/menu returns 403 for a diner', async () => {
    const newItem = { title: 'Test Pizza', description: 'A test pizza', image: 'pizza1.png', price: 0.99 };
    const res = await request(app)
        .put('/api/order/menu')
        .set('Authorization', `Bearer ${testUserAuthToken}`)
        .send(newItem);
    expect(res.status).toBe(403);
});

test('GET /api/order returns the authenticated user orders', async () => {
    const res = await request(app).get('/api/order').set('Authorization', `Bearer ${testUserAuthToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.orders)).toBe(true);
});

test('POST /api/order creates an order', async () => {
    const franchiseName = 'Test Franchise ' + Math.random().toString(36).substring(2, 12);
    const franchise = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send({ name: franchiseName, admins: [{ email: testUser.email }] });
    const franchiseId = franchise.body.id;

    const store = await request(app)
        .post(`/api/franchise/${franchiseId}/store`)
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send({ name: 'Test Store' });

    const newItem = { title: 'Test Pizza', description: 'A test pizza', image: 'pizza1.png', price: 0.99 };
    const menuItem = await request(app)
        .put('/api/order/menu')
        .set('Authorization', `Bearer ${adminAuthToken}`)
        .send(newItem);
    const created = menuItem.body.filter((item) => item.title === newItem.title).at(-1);

    const newOrder = {
        franchiseId,
        storeId: store.body.id,
        items: [{ menuId: created.id, description: created.description, price: created.price }],
    };

    try {
        const res = await request(app)
            .post('/api/order')
            .set('Authorization', `Bearer ${testUserAuthToken}`)
            .send(newOrder);
        expect(res.status).toBe(200);
    } finally {
        await request(app).delete(`/api/franchise/${franchiseId}`).set('Authorization', `Bearer ${adminAuthToken}`);
    }
});
