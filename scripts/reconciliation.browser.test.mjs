// Run with node --test scripts/reconciliation.browser.test.mjs and local Chrome.
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

test('reconciles and safeguards corrections through the register', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'envelove-reconcile-browser-'))
  let server
  let browser
  t.after(async () => {
    await browser?.close()
    if (server && server.exitCode === null && server.signalCode === null) {
      const stopped = once(server, 'exit')
      server.kill()
      await stopped
    }
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  process.env.DATABASE_URL = join(directory, 'fixture.sqlite')
  process.env.SEED_EMAIL = 'register@example.invalid'
  process.env.AUTH_ALLOWED_EMAILS = process.env.SEED_EMAIL
  const db = new Database(process.env.DATABASE_URL)

  const files = readdirSync('drizzle')
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of files.filter((file) => file < '0012'))
    db.exec(readFileSync(join('drizzle', name), 'utf8'))
  db.exec(`
    INSERT INTO user(id,name,email,email_verified) VALUES('owner','Fixture','legacy@example.invalid',1);
    INSERT INTO plans(id,owner_id,name,country_code,currency_code) VALUES('plan','owner','Fixture','US','USD');
    INSERT INTO accounts(id,plan_id,name,type) VALUES('a','plan','Account A','checking'),('b','plan','Account B','savings'),('c','plan','Account C','cash'),('card','plan','Credit','credit_card'),('tracking','plan','Tracking','asset'),('loan','plan','Loan','personal_loan'),('line','plan','Line','line_of_credit'),('liability','plan','Liability','liability');
    INSERT INTO accounts(id,plan_id,name,type,closed) VALUES ('closed','plan','Closed','checking',1);
    INSERT INTO transfers(id,plan_id) VALUES('pair','plan');
    INSERT INTO transactions(id,account_id,date,amount,cleared,transfer_id,transfer_side) VALUES('from','a','2026-01-01',-100000,1,'pair','outflow'),('to','b','2026-01-01',100000,0,'pair','inflow');
    INSERT INTO transactions(id,account_id,date,amount,cleared) VALUES('initial','a','2026-01-01',1100000,1),('pending','a','2026-01-02',300000,0),('future','a','2099-01-01',500000,0),('debt','card','2026-01-01',-1000000,1);
  `)
  const balances = () =>
    db
      .prepare(
        'SELECT account_id,cleared,sum(amount) AS amount FROM transactions GROUP BY account_id,cleared ORDER BY account_id,cleared',
      )
      .all()
  const original = balances()
  for (const name of files.filter((file) => file >= '0012'))
    db.exec(readFileSync(join('drizzle', name), 'utf8'))
  assert.deepEqual(balances(), original)
  assert.throws(
    () =>
      db
        .prepare("UPDATE transactions SET reconciled=1 WHERE id='pending'")
        .run(),
    /CHECK constraint failed/,
  )
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  assert.equal(
    db
      .prepare(
        'SELECT count(*) FROM transactions WHERE reconciled OR reconciliation_adjustment',
      )
      .pluck()
      .get(),
    0,
  )
  assert.equal(
    db
      .prepare(
        'SELECT count(*) FROM accounts WHERE last_reconciled_at IS NOT NULL',
      )
      .pluck()
      .get(),
    0,
  )
  const portProbe = createServer()
  portProbe.listen(0, 'localhost')
  await once(portProbe, 'listening')
  const port = portProbe.address().port
  await new Promise((resolve) => portProbe.close(resolve))
  const origin = 'http://localhost:' + port
  server = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'dev',
      '--host',
      'localhost',
      '--port',
      String(port),
      '--strictPort',
    ],
    { env: { ...process.env, BETTER_AUTH_URL: origin }, stdio: 'ignore' },
  )
  let ready = false
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    if (server.exitCode !== null)
      throw new Error('Fixture server failed to start')
    try {
      ready = (await fetch(origin + '/login')).ok
    } catch {
      await delay(200)
    }
  }
  assert.ok(ready, 'Fixture server is ready')
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  // Cold Vite route compilation is not part of the UI action budget.
  page.setDefaultNavigationTimeout(30000)
  // Share the session cookie without loading the unrelated starter Plan.
  const signIn = await page.request.get(origin + '/api/dev/sign-in', {
    maxRedirects: 0,
  })
  assert.equal(signIn.status(), 302)
  assert.equal(signIn.headers().location, '/')
  const signedInOwner = db
    .prepare('SELECT id FROM user WHERE email=?')
    .pluck()
    .get(process.env.SEED_EMAIL)
  assert.ok(signedInOwner)
  const systemCategories = db
    .prepare(
      "SELECT p.id FROM plans p JOIN category_groups g ON g.plan_id=p.id JOIN categories c ON c.category_group_id=g.id WHERE g.kind='inflow' AND c.kind='ready_to_assign'",
    )
    .all()
  assert.equal(
    systemCategories.length,
    2,
    'The migrated Plan and the new starter Plan each have Ready to Assign',
  )
  db.prepare("UPDATE plans SET owner_id=? WHERE id='plan'").run(signedInOwner)
  const visit = async (id = '') => {
    await page.goto(origin + '/plans/plan/accounts/' + id)
    await page.waitForLoadState('networkidle')
    await page.getByRole('searchbox', { name: 'Search transactions' }).waitFor()
  }
  const button = (name) => page.getByRole('button', { name, exact: true })
  const row = (id) => page.locator('[data-transaction-id="' + id + '"]')
  const edit = async (id) =>
    row(id).getByRole('button', { name: 'Edit Transaction' }).click()
  const save = () => button('Save Transaction').click()
  const dialog = page.getByRole('alertdialog')
  const locked = (id) =>
    row(id).getByRole('img', { name: 'This transaction is reconciled' })
  const target = async (value) => {
    await button('Reconcile').click()
    await button('No').click()
    await page.getByLabel('Current balance at your bank').fill(value)
    await button('Next').click()
  }
  const inspect = async (value) => {
    await target(value)
    const explanation = page.getByRole('dialog', { name: 'Difference' })
    await explanation.getByRole('button', { name: 'Continue' }).click()
  }
  const visibleAfterSave = async () => {
    await button('View All')
      .click()
      .catch(async (cause) => {
        throw new Error(
          'Expected completed reconciliation. ' +
            (await page
              .getByRole('region', { name: 'Account reconciliation' })
              .innerText()),
          { cause },
        )
      })
  }
  await visit('a')
  const reconcileButton = await button('Reconcile').boundingBox()
  assert.ok(
    reconcileButton.x >= 0 && reconcileButton.x + reconcileButton.width <= 390,
  )
  await button('Add Transaction').click()
  for (const field of [
    page.getByLabel('Outflow', { exact: true }),
    button('Save Transaction'),
  ]) {
    const box = await field.boundingBox()
    assert.ok(
      box && box.x >= 0 && box.x + box.width <= 390,
      'The expense editor fits the phone without panning',
    )
  }
  await button('Reconcile').click()
  await page
    .getByText('Is your current balance $1,000.00?', { exact: true })
    .waitFor()
  const prompt = page.getByRole('dialog', { name: 'Reconcile account' })
  const promptBox = await prompt.boundingBox()
  assert.ok(promptBox.x >= 0 && promptBox.x + promptBox.width <= 390)
  await prompt.getByText('How do I find my account balance?').click()
  await prompt.getByText(/Use your bank’s current posted balance/).waitFor()
  await prompt.getByRole('button', { name: 'Yes' }).click()
  await visibleAfterSave()
  await button('Cancel editing').click()
  await locked('initial').waitFor()
  assert.equal(await locked('pending').count(), 0)
  assert.equal(
    db
      .prepare("SELECT reconciled FROM transactions WHERE id='to'")
      .pluck()
      .get(),
    0,
  )
  await button('Hide Reconciled').click()
  assert.equal(await row('initial').count(), 0)
  await visibleAfterSave()
  await page.setViewportSize({ width: 1440, height: 900 })
  await edit('initial')
  await page.getByLabel('Inflow', { exact: true }).fill('1200')
  await save()
  await dialog.getByText('Save Changes to Reconciled Transaction').waitFor()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  assert.equal(
    db
      .prepare("SELECT amount FROM transactions WHERE id='initial'")
      .pluck()
      .get(),
    1100000,
  )
  await save()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await locked('initial').waitFor()
  await inspect('1400')
  await edit('pending')
  await page.getByLabel('Memo', { exact: true }).fill('Compared with bank')
  await save()
  await row('pending').getByText('Compared with bank').waitFor()
  await button('Cancel').click()
  assert.equal(
    db
      .prepare("SELECT memo FROM transactions WHERE id='pending'")
      .pluck()
      .get(),
    'Compared with bank',
  )
  assert.equal(
    db
      .prepare("SELECT reconciled FROM transactions WHERE id='pending'")
      .pluck()
      .get(),
    0,
  )
  await inspect('1400')
  await edit('pending')
  await button('Cleared').click()
  await save()
  await button('Finish Reconciliation').click()
  await visibleAfterSave()
  assert.equal(
    db
      .prepare(
        'SELECT count(*) FROM transactions WHERE reconciliation_adjustment',
      )
      .pluck()
      .get(),
    0,
  )

  await inspect('800')
  // Concurrent offsetting edits change the reviewed entries without changing the sum.
  db.exec(
    "UPDATE transactions SET amount=amount+1000 WHERE id='initial';UPDATE transactions SET amount=amount-1000 WHERE id='pending'",
  )
  await button('Create Adjustment & Finish').click()
  await page
    .getByRole('alert')
    .filter({ hasText: /register changed/i })
    .waitFor()
  assert.equal(
    db
      .prepare(
        'SELECT count(*) FROM transactions WHERE reconciliation_adjustment',
      )
      .pluck()
      .get(),
    0,
  )
  await button('Create Adjustment & Finish').click()
  await visibleAfterSave()
  const adjustment = db
    .prepare(
      "SELECT id,amount FROM transactions WHERE account_id='a' AND reconciliation_adjustment",
    )
    .get()
  assert.equal(adjustment.amount, -600000)
  await locked(adjustment.id).waitFor()
  await button('Undo').click()
  await row(adjustment.id).waitFor({ state: 'detached' })
  assert.equal(
    db
      .prepare(
        'SELECT count(*) FROM transactions WHERE reconciliation_adjustment',
      )
      .pluck()
      .get(),
    0,
  )
  await button('Redo').click()
  await locked(adjustment.id).waitFor()

  await row(adjustment.id)
    .getByRole('button', { name: 'Delete Transaction' })
    .click()
  await dialog.getByText('Delete Reconciled Transaction?').waitFor()
  db.exec(
    "CREATE TRIGGER fail_delete BEFORE DELETE ON transactions BEGIN SELECT RAISE(ABORT,'fixture failure');END",
  )
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await dialog
    .getByRole('alert')
    .getByText('Could not delete this Transaction. Please try again.')
    .waitFor()
  db.exec('DROP TRIGGER fail_delete')
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await row(adjustment.id).count(), 0)

  await visit()
  assert.equal(await button('Reconcile').count(), 0)
  await edit('to')
  await page.getByLabel('Account', { exact: true }).click()
  await page.getByRole('option', { name: 'Account C' }).click()
  await save()
  await dialog.getByText('Save Changes to Reconciled Transfer').waitFor()
  await dialog.getByText(/already been reconciled in Account A/).waitFor()
  assert.equal(
    db
      .prepare("SELECT account_id FROM transactions WHERE id='to'")
      .pluck()
      .get(),
    'b',
  )
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await row('from').getByText('To/From Account C').waitFor()
  await row('to').getByRole('button', { name: 'Delete Transaction' }).click()
  await dialog.getByText('Delete Reconciled Transfer?').waitFor()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  assert.equal(
    db
      .prepare("SELECT count(*) FROM transactions WHERE transfer_id='pair'")
      .pluck()
      .get(),
    2,
  )
  await edit('to')
  await page.getByLabel('Date', { exact: true }).fill('12/31/2099')
  await page.getByLabel('Memo', { exact: true }).focus()
  await page.getByText('Both sides are Uncleared.').waitFor()
  await button('Cancel editing').click()
  await locked('from').waitFor()
  await edit('to')
  await page.getByLabel('Date', { exact: true }).fill('12/31/2099')
  await page.getByLabel('Memo', { exact: true }).focus()
  await save()
  await row('to').waitFor()
  assert.equal(
    db
      .prepare(
        "SELECT sum(cleared+reconciled) FROM transactions WHERE transfer_id='pair'",
      )
      .pluck()
      .get(),
    0,
  )
  await edit('to')
  await page.getByLabel('Date', { exact: true }).fill('01/01/2026')
  await page.getByLabel('Memo', { exact: true }).focus()
  await save()
  await row('to').waitFor()
  assert.equal(
    db
      .prepare(
        "SELECT sum(cleared+reconciled) FROM transactions WHERE transfer_id='pair'",
      )
      .pluck()
      .get(),
    0,
  )

  await visit('card')
  for (const [value, expected, sign] of [
    ['300', 700000, '-$300.00'],
    ['+300', 600000, '+$300.00'],
  ]) {
    await inspect(value)
    await page
      .getByRole('status')
      .getByText('Bank balance ' + sign + '.', { exact: true })
      .waitFor()
    await button('Create Adjustment & Finish').click()
    await visibleAfterSave()
    assert.equal(
      db
        .prepare(
          "SELECT amount FROM transactions WHERE account_id='card' AND reconciliation_adjustment ORDER BY rowid DESC LIMIT 1",
        )
        .pluck()
        .get(),
      expected,
    )
  }
  await visit('tracking')
  await target('0')
  await button('Finish Reconciliation').click()
  await visibleAfterSave()
  assert.equal(
    db
      .prepare("SELECT count(*) FROM transactions WHERE account_id='tracking'")
      .pluck()
      .get(),
    0,
  )
  await inspect('-200')
  await button('Create Adjustment & Finish').click()
  await visibleAfterSave()
  assert.deepEqual(
    db
      .prepare(
        "SELECT amount,category_id FROM transactions WHERE account_id='tracking'",
      )
      .get(),
    { amount: -200000, category_id: null },
  )
  for (const id of ['b', 'c', 'line', 'liability']) {
    await visit(id)
    await button('Reconcile').click()
    await button('Yes').waitFor()
    await button('Cancel').click()
  }
  await visit('tracking')
  await page
    .getByRole('button', { name: /Fixture.*register@example.invalid/ })
    .click()
  await page.getByRole('menuitem', { name: 'Plan settings' }).click()
  const preference = page.getByRole('checkbox', {
    name: 'Always show reconciled transactions after reconciliation',
  })
  assert.equal(await preference.isChecked(), false)
  await preference.check()
  await button('Save changes').click()
  await page
    .getByRole('dialog', { name: 'Plan settings' })
    .waitFor({ state: 'hidden' })
  await button('Reconcile').click()
  await button('Yes').click()
  await button('Hide Reconciled').waitFor()
  await page
    .getByRole('img', { name: 'This transaction is reconciled' })
    .waitFor()
  assert.equal(
    db
      .prepare("SELECT hide_after_reconciliation FROM plans WHERE id='plan'")
      .pluck()
      .get(),
    0,
  )
  await button('Hide Reconciled').click()
  await button('View All').click()
  for (const id of ['loan', 'closed']) {
    await visit(id)
    assert.equal(await button('Reconcile').count(), 0)
  }
})
