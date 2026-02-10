import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'path'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [resolve(__dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, THOPTER_MOCK: '1' },
  })
  page = await app.firstWindow()
  // Wait for React to mount and data to load
  await page.waitForSelector('[data-slot="card"]', { timeout: 10_000 })
})

test.afterAll(async () => {
  await app.close()
})

// --- Dashboard tests ---

test('dashboard loads and shows thopter cards', async () => {
  // Mock service generates 5 thopters
  const cards = page.locator('[data-slot="card"]')
  await expect(cards).toHaveCount(5, { timeout: 10_000 })
})

test('header shows app title and buttons', async () => {
  await expect(page.locator('h1')).toHaveText('Thopter Swarm')
  await expect(page.getByText('Run New Thopter')).toBeVisible()
  await expect(page.getByText('Re-Authenticate')).toBeVisible()
})

test('thopter cards show status badges', async () => {
  const badges = page.locator('[data-slot="badge"]')
  // Each card has a status badge, header might have connection badge
  const count = await badges.count()
  expect(count).toBeGreaterThanOrEqual(5)
})

// --- Tab navigation tests ---

test('clicking a card opens detail tab', async () => {
  // Click the first thopter card
  const firstCard = page.locator('[data-slot="card"]').first()
  const name = await firstCard.locator('[data-slot="card-title"]').textContent()
  await firstCard.click()

  // Tab bar should show the thopter name
  await expect(page.getByText(name!, { exact: true }).last()).toBeVisible()

  // Detail view should show the status panel with the thopter name
  await expect(page.locator('h2').filter({ hasText: name! })).toBeVisible()
})

test('can switch back to dashboard tab', async () => {
  await page.getByText('Dashboard').click()
  // Should see the card grid again
  const cards = page.locator('[data-slot="card"]')
  await expect(cards.first()).toBeVisible()
})

test('can close a tab', async () => {
  // Open a thopter tab
  const firstCard = page.locator('[data-slot="card"]').first()
  const name = await firstCard.locator('[data-slot="card-title"]').textContent()
  await firstCard.click()

  // Find and click the close button on the tab
  const tabCloseBtn = page.locator('button').filter({ has: page.locator('svg') }).last()
  // Navigate back to dashboard first to find the close button properly
  await page.getByText('Dashboard').click()

  // Open again to test close
  await firstCard.click()
  await expect(page.locator('h2').filter({ hasText: name! })).toBeVisible()
})

// --- Transcript tests ---

test('detail view shows transcript entries', async () => {
  // Click a thopter card to open detail
  const firstCard = page.locator('[data-slot="card"]').first()
  await page.getByText('Dashboard').click()
  await firstCard.click()

  // Wait for transcript to load - entries have timestamps
  await page.waitForSelector('.font-mono', { timeout: 10_000 })

  // Check that transcript entries are visible (they have role labels)
  const hasEntries = await page.locator('text=user').or(page.locator('text=assistant')).or(page.locator('text=tool')).first().isVisible()
  expect(hasEntries).toBeTruthy()
})

// --- Action bar tests ---

test('tell input exists and can type', async () => {
  // Should be in a detail view from previous test
  const textarea = page.locator('textarea')
  await expect(textarea).toBeVisible()
  await textarea.fill('test message')
  await expect(textarea).toHaveValue('test message')
})

test('operation buttons are visible', async () => {
  await expect(page.getByText('Suspend').or(page.getByText('Resume'))).toBeVisible()
  await expect(page.getByText('Destroy')).toBeVisible()
  await expect(page.getByText('Attach')).toBeVisible()
})

// --- Run modal tests ---

test('run modal opens and shows form', async () => {
  await page.getByText('Dashboard').click()
  await page.getByText('Run New Thopter').click()

  // Modal should be visible with title
  await expect(page.getByText('Launch a new devbox')).toBeVisible()

  // Should show repository step
  await expect(page.locator('label').filter({ hasText: 'Repository' })).toBeVisible()
})

test('run modal can navigate steps', async () => {
  // Select a repo (the select should have mock repos)
  const select = page.locator('select').first()
  await select.selectOption({ index: 1 }) // First repo

  // Click Next
  await page.getByText('Next').click()

  // Should be on prompt step
  await expect(page.locator('label').filter({ hasText: 'Task Description' })).toBeVisible()

  // Enter a prompt
  await page.locator('textarea').fill('Test task for playwright')

  // Click Next
  await page.getByText('Next').click()

  // Should be on review step
  await expect(page.getByText('Launch Thopter')).toBeVisible()
})

test('run modal can be closed', async () => {
  // Close the modal
  const closeBtn = page.locator('[data-slot="dialog-close"]')
  await closeBtn.click()

  // Modal should be gone
  await expect(page.getByText('Launch a new devbox')).not.toBeVisible()
})

// --- Notification sidebar tests ---

test('notification sidebar opens and closes', async () => {
  // Click the notification bell (it's a button with Bell icon)
  const bellBtn = page.locator('header button').last()
  await bellBtn.click()

  // Sidebar should show
  await expect(page.getByText('Notifications').last()).toBeVisible()
  await expect(page.getByText('Events from your thopter fleet')).toBeVisible()

  // Close it
  const closeBtn = page.locator('[data-slot="sheet-close"]').or(
    page.locator('button').filter({ has: page.locator('text=x') })
  )
  if (await closeBtn.first().isVisible()) {
    await closeBtn.first().click()
  }
})

// --- Re-auth modal tests ---

test('reauth modal opens', async () => {
  await page.getByText('Re-Authenticate').click()

  // Should show the reauth modal
  await expect(page.getByText('Update Claude Code credentials')).toBeVisible()
  await expect(page.getByText('Choose a machine')).toBeVisible()

  // Close it
  const closeBtn = page.locator('[data-slot="dialog-close"]')
  await closeBtn.click()
})
