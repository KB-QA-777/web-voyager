'use strict';
const { test, expect, TICKET_ID, USERS } = require('../lib/fixtures');

// Every test below gets a fresh TCK-101 and two independent logged-in sessions (A and B).
// No waitForTimeout / sleep anywhere: every wait is an auto-retrying expect on a real signal
// (DOM state, a network response, a new page event).

test.describe('Shared ticket TCK-101 across two sessions', () => {
  test('Sessions: two isolated contexts, logged in as different users, both show the same record', async ({ sessions, log }) => {
    const { A, B } = sessions;
    await expect(A.page.getByTestId('ticket-id')).toHaveText(TICKET_ID);
    await expect(B.page.getByTestId('ticket-id')).toHaveText(TICKET_ID);
    await expect(A.page.getByTestId('current-user')).toHaveText(USERS.A.username);
    await expect(B.page.getByTestId('current-user')).toHaveText(USERS.B.username);
    // Contexts are isolated: cookies do not leak between them.
    const [ca, cb] = await Promise.all([A.context.cookies(), B.context.cookies()]);
    expect(ca.find((c) => c.name === 'sid').value).not.toBe(cb.find((c) => c.name === 'sid').value);
    log('-', 'both sessions show TCK-101 with distinct session cookies');
  });

  test('Sync: A changes status to "In Review"; B shows "In Review" live and after refresh', async ({ sessions, log }) => {
    const { A, B } = sessions;
    await A.page.getByTestId('status').selectOption('In Review');
    const [resp] = await Promise.all([
      A.page.waitForResponse((r) => r.url().endsWith(`/api/tickets/${TICKET_ID}`) && r.request().method() === 'PUT'),
      A.page.getByTestId('save').click(),
    ]);
    expect(resp.status()).toBe(200);
    await expect(A.page.getByTestId('message')).toHaveText('Saved');
    log('A', 'saved status=In Review');

    // Live: B has not been touched; the SSE push must update it.
    await expect(B.page.getByTestId('status')).toHaveValue('In Review');
    await expect(B.page.getByTestId('last-editor')).toHaveText(USERS.A.username);
    log('B', 'status shows In Review (live, no refresh)');

    // After refresh: the server-rendered page must agree.
    await B.page.reload();
    await expect(B.page.getByTestId('status')).toHaveValue('In Review');
    log('B', 'status shows In Review after refresh');
  });

  test('Collision: A and B save the same field within the same second; both show one final value and the winner is recorded', async ({ sessions, api, log }) => {
    const { A, B } = sessions;
    await A.page.getByTestId('priority').selectOption('High');
    await B.page.getByTestId('priority').selectOption('Low');

    const putOf = (page) => page.waitForResponse((r) => r.url().endsWith(`/api/tickets/${TICKET_ID}`) && r.request().method() === 'PUT');
    // A saves first, B saves immediately after: deterministic order, same second.
    const [respA] = await Promise.all([putOf(A.page), A.page.getByTestId('save').click()]);
    const [respB] = await Promise.all([putOf(B.page), B.page.getByTestId('save').click()]);
    const [bodyA, bodyB] = await Promise.all([respA.json(), respB.json()]);
    const gapMs = Math.abs(bodyB.updatedAt - bodyA.updatedAt);
    log('A', `saved priority=High -> server version ${bodyA.version} at ${bodyA.updatedAt}`);
    log('B', `saved priority=Low  -> server version ${bodyB.version} at ${bodyB.updatedAt}`);
    expect(gapMs, 'both saves must land within the same second').toBeLessThan(1000);

    // The server is last-write-wins: the final record decides which edit won.
    const final = await (await api.get(`/api/tickets/${TICKET_ID}`)).json();
    const winner = final.updatedBy === USERS.A.username ? 'A' : 'B';
    log('-', `COLLISION RESULT: winner=${winner} (${final.updatedBy}) final priority=${final.priority} version=${final.version} gap=${gapMs}ms`);
    expect(final.priority).toBe('Low'); // B's write arrived last
    expect(winner).toBe('B');

    // Both screens converge on the one identical final value: never "High" on one and "Low" on the other.
    await expect(A.page.getByTestId('priority')).toHaveValue(final.priority);
    await expect(B.page.getByTestId('priority')).toHaveValue(final.priority);
    await expect(A.page.getByTestId('version')).toHaveText(String(final.version));
    await expect(B.page.getByTestId('version')).toHaveText(String(final.version));
    await expect(A.page.getByTestId('last-editor')).toHaveText(final.updatedBy);
    await expect(B.page.getByTestId('last-editor')).toHaveText(final.updatedBy);
  });

  test('Stale data: B deletes the record; A, still on the old page, saves and sees "Record no longer exists"', async ({ sessions, api, log }) => {
    const { A, B } = sessions;
    const [delResp] = await Promise.all([
      B.page.waitForResponse((r) => r.url().endsWith(`/api/tickets/${TICKET_ID}`) && r.request().method() === 'DELETE'),
      B.page.getByTestId('delete').click(),
    ]);
    expect(delResp.status()).toBe(204);
    await expect(B.page.getByTestId('message')).toHaveText('Ticket deleted');
    log('B', `deleted ${TICKET_ID}`);
    expect((await api.get(`/api/tickets/${TICKET_ID}`)).status()).toBe(404);

    // A never refreshed; it still shows the old record and tries to save an edit.
    await expect(A.page.getByTestId('ticket-id')).toHaveText(TICKET_ID);
    await A.page.getByTestId('title').fill('Edited after deletion');
    const [saveResp] = await Promise.all([
      A.page.waitForResponse((r) => r.url().endsWith(`/api/tickets/${TICKET_ID}`) && r.request().method() === 'PUT'),
      A.page.getByTestId('save').click(),
    ]);
    expect(saveResp.status()).toBe(410);
    await expect(A.page.getByTestId('message')).toBeVisible();
    await expect(A.page.getByTestId('message')).toHaveText('Record no longer exists');
    log('A', 'save rejected with visible message "Record no longer exists"');
  });

  test('Popup: A opens "Print preview" in a new tab; it shows TCK-101; the main tab keeps its unsaved edits', async ({ sessions, log }) => {
    const { A } = sessions;
    const unsaved = 'Unsaved draft title';
    await A.page.getByTestId('title').fill(unsaved);

    const [popup] = await Promise.all([
      A.context.waitForEvent('page'),
      A.page.getByTestId('print-preview').click(),
    ]);
    await popup.waitForLoadState();
    await expect(popup).toHaveURL(new RegExp(`/tickets/${TICKET_ID}/print$`));
    await expect(popup.getByTestId('print-ticket-id')).toHaveText(TICKET_ID);
    // The print view reflects the SAVED record, not the unsaved draft.
    await expect(popup.getByTestId('print-title')).toHaveText('Initial title');
    log('A', `popup opened at ${popup.url()} showing ${TICKET_ID}`);
    const popupShot = `${process.env.EVIDENCE_DIR}/popup-print-preview.png`;
    await popup.screenshot({ path: popupShot });
    await popup.close();
    await expect.poll(() => A.context.pages().length).toBe(1);

    // Back in the main tab, the draft is intact and nothing was saved.
    await expect(A.page.getByTestId('title')).toHaveValue(unsaved);
    await expect(A.page.getByTestId('version')).toHaveText('1');
    await expect(A.page.getByTestId('message')).toBeHidden();
    log('A', 'popup closed; main tab unsaved edit intact');
  });

  test('Clean up: test data is removed at the end of the run and a rerun creates it fresh', async ({ sessions, api, ticket, log }) => {
    // The `ticket` fixture already proved TCK-101 did not exist before this test (404) and created it.
    expect(ticket.version).toBe(1);
    expect(ticket.title).toBe('Initial title');
    // Simulate "a rerun": delete, confirm gone, create again, and it comes back in the identical initial state.
    expect((await api.delete(`/api/tickets/${TICKET_ID}`)).status()).toBe(204);
    expect((await api.get(`/api/tickets/${TICKET_ID}`)).status()).toBe(404);
    const again = await api.post('/api/tickets', { data: { id: TICKET_ID, title: 'Initial title', status: 'Open', priority: 'Medium' } });
    expect(again.status()).toBe(201);
    const fresh = await again.json();
    expect(fresh).toMatchObject({ id: TICKET_ID, title: 'Initial title', status: 'Open', priority: 'Medium', version: 1 });
    await sessions.A.page.reload();
    await expect(sessions.A.page.getByTestId('version')).toHaveText('1');
    log('-', 'rerun created TCK-101 fresh in the identical initial state; fixture teardown deletes it again');
  });
});
