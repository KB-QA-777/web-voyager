'use strict';
/**
 * Shared fixtures:
 *   log      - session-tagged run logger -> evidence/<RUN_ID>/run.log
 *   api      - authenticated API client (User A) for setup / cleanup
 *   ticket   - creates TCK-101 fresh before each test and removes it afterwards
 *   sessions - two isolated browser contexts, logged in as User A and User B,
 *              both on the ticket page with live sync connected. Screenshots of both
 *              sessions are captured and attached at the end of every test.
 */
const base = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const TICKET_ID = 'TCK-101';
const USERS = {
  A: { username: 'usera.test', password: 'test-password-a' },
  B: { username: 'userb.test', password: 'test-password-b' },
};

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

const test = base.test.extend({
  log: async ({}, use, testInfo) => {
    const runId = process.env.RUN_ID;
    const file = path.join(process.env.EVIDENCE_DIR, 'run.log');
    const write = (session, msg) => {
      const line = `${new Date().toISOString()} [run=${runId}] [test=${slug(testInfo.title)}] [session=${session}] ${msg}\n`;
      fs.appendFileSync(file, line);
    };
    write('-', `START ${testInfo.title}`);
    await use(write);
    write('-', `END ${testInfo.title} status=${testInfo.status} duration=${testInfo.duration}ms`);
  },

  api: async ({ playwright, baseURL }, use) => {
    const ctx = await playwright.request.newContext({ baseURL });
    const r = await ctx.post('/login', { form: USERS.A, maxRedirects: 0 });
    if (r.status() !== 302) throw new Error(`API login failed: ${r.status()}`);
    await use(ctx);
    await ctx.dispose();
  },

  ticket: async ({ api, log }, use) => {
    // Prove the previous run / test cleaned up: the record must not exist yet.
    const before = await api.get(`/api/tickets/${TICKET_ID}`);
    base.expect(before.status(), `${TICKET_ID} must not exist before the test (clean-up proof)`).toBe(404);
    const created = await api.post('/api/tickets', {
      data: { id: TICKET_ID, title: 'Initial title', status: 'Open', priority: 'Medium' },
    });
    base.expect(created.status()).toBe(201);
    log('-', `created ${TICKET_ID} version=1`);
    await use(await created.json());
    // Clean up: remove whatever the test left behind and verify it is gone.
    const del = await api.delete(`/api/tickets/${TICKET_ID}`);
    base.expect([204, 404]).toContain(del.status());
    const after = await api.get(`/api/tickets/${TICKET_ID}`);
    base.expect(after.status()).toBe(404);
    log('-', `cleaned up ${TICKET_ID} (delete=${del.status()}, get=${after.status()})`);
  },

  sessions: async ({ browser, ticket, log }, use, testInfo) => {
    const open = async (key) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto('/login');
      await page.getByLabel('Username').fill(USERS[key].username);
      await page.getByLabel('Password').fill(USERS[key].password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await base.expect(page).toHaveURL(/\/$/);
      await page.goto(`/tickets/${ticket.id}`);
      await base.expect(page.getByTestId('current-user')).toHaveText(USERS[key].username);
      // Real signal that the live channel is up, instead of a sleep.
      await base.expect(page.locator('body[data-live="connected"]')).toBeAttached();
      log(key, `logged in as ${USERS[key].username}, on /tickets/${ticket.id}, live sync connected`);
      return { key, user: USERS[key].username, context, page };
    };
    const A = await open('A');
    const B = await open('B');
    await use({ A, B });

    // Evidence: a screenshot from BOTH sessions, whatever the outcome.
    for (const s of [A, B]) {
      if (s.page.isClosed()) continue;
      const file = path.join(process.env.EVIDENCE_DIR, `${slug(testInfo.title)}-session-${s.key}.png`);
      await s.page.screenshot({ path: file, fullPage: true });
      await testInfo.attach(`session-${s.key}`, { path: file, contentType: 'image/png' });
      log(s.key, `screenshot ${path.relative(process.cwd(), file)}`);
      await s.context.close();
    }
  },
});

module.exports = { test, expect: base.expect, TICKET_ID, USERS };
